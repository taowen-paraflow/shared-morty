import * as v from "valibot";
import { withDeadline } from "../shared/async.ts";
import { chatRequestSchema } from "../shared/chat-protocol.ts";
import { AppError } from "../shared/errors.ts";
import { fromBase64, toBase64 } from "../shared/login-crypto.ts";
import { parseJson } from "../shared/login-protocol.ts";
import { repositoryName } from "../shared/runner-status.ts";

const DATABASE = "shared-morty-browser-v1";
const STORE = "vault";
const connectionSchema = v.object({
    version: v.literal(1),
    repository: v.string(),
    userId: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/u)),
    token: v.pipe(v.string(), v.minLength(1), v.maxLength(8192)),
});
export type SavedConnection = Readonly<v.InferOutput<typeof connectionSchema>>;
const recoverySchema = v.object({
    version: v.literal(1),
    phase: v.picklist(["waiting", "stopping"]),
    repository: v.string(),
    issue: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER)),
    request: chatRequestSchema,
    key: v.object({ publicKey: v.string(), privateKey: v.instance(CryptoKey) }),
});
export type ChatRecovery = Readonly<Omit<v.InferOutput<typeof recoverySchema>, "key" | "request">> & {
    readonly request: Readonly<v.InferOutput<typeof chatRequestSchema>>;
    readonly key: { readonly publicKey: string; readonly privateKey: CryptoKey };
};

async function openDatabase(signal: AbortSignal): Promise<IDBDatabase> {
    if (signal.aborted) throw new AppError("cancelled");
    if (typeof indexedDB === "undefined") throw new AppError("storage_unavailable");
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        let settled = false;
        const fail = (cause: AppError) => {
            settled = true;
            signal.removeEventListener("abort", abort);
            reject(cause);
        };
        const abort = () => fail(new AppError("cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE);
        };
        request.onerror = () => fail(new AppError("storage_unavailable", request.error));
        request.onblocked = () => fail(new AppError("storage_unavailable"));
        request.onsuccess = () => {
            signal.removeEventListener("abort", abort);
            if (settled || signal.aborted) {
                request.result.close();
                reject(new AppError("cancelled"));
            } else resolve(request.result);
        };
    });
}

async function access<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
    signal: AbortSignal,
): Promise<unknown> {
    return withDeadline(8_000, signal, async (bounded) => {
        const database = await openDatabase(bounded);
        try {
            if (bounded.aborted) throw new AppError("cancelled");
            return await new Promise<unknown>((resolve, reject) => {
                const transaction = database.transaction(STORE, mode);
                let value: unknown;
                const abort = () => {
                    try {
                        transaction.abort();
                    } catch {
                        /* Already completed. */
                    }
                };
                bounded.addEventListener("abort", abort, { once: true });
                const finish = () => bounded.removeEventListener("abort", abort);
                transaction.oncomplete = () => {
                    finish();
                    resolve(value);
                };
                transaction.onabort = () => {
                    finish();
                    reject(
                        new AppError(
                            bounded.aborted ? "cancelled" : "storage_unavailable",
                            transaction.error,
                        ),
                    );
                };
                transaction.onerror = () => {
                    /* onabort owns completion. */
                };
                try {
                    const request = operation(transaction.objectStore(STORE));
                    request.onsuccess = () => {
                        value = request.result;
                    };
                } catch (cause) {
                    finish();
                    abort();
                    reject(new AppError("storage_unavailable", cause));
                }
            });
        } finally {
            database.close();
        }
    });
}

async function vaultKey(signal: AbortSignal): Promise<CryptoKey> {
    const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
    ]);
    let selected: unknown;
    await access(
        "readwrite",
        (store) => {
            const request = store.get("connection-key");
            request.addEventListener("success", () => {
                const current: unknown = request.result;
                selected = current === undefined ? candidate : current;
                if (current === undefined) store.put(candidate, "connection-key");
            });
            return request;
        },
        signal,
    );
    const parsed = v.safeParse(v.instance(CryptoKey), selected);
    if (
        !parsed.success ||
        parsed.output.type !== "secret" ||
        parsed.output.extractable ||
        parsed.output.algorithm.name !== "AES-GCM"
    )
        throw new AppError("invalid_response");
    return parsed.output;
}

const connectionSlot = (apiOrigin?: string) => `connection:${apiOrigin ?? "https://api.github.com"}`;
const chatSlot = (repository: string, userId: string) => `chat:${repositoryName(repository)}:${userId}`;
export async function rememberConnection(
    input: SavedConnection,
    apiOrigin: string | undefined,
    signal: AbortSignal,
): Promise<void> {
    const key = await vaultKey(signal);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const slot = connectionSlot(apiOrigin);
    const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(slot) },
        key,
        new TextEncoder().encode(JSON.stringify(input)),
    );
    await access(
        "readwrite",
        (store) => store.put({ version: 1, iv: toBase64(iv), data: toBase64(data) }, slot),
        signal,
    );
}

export async function recallConnection(
    apiOrigin: string | undefined,
    signal: AbortSignal,
): Promise<SavedConnection | null> {
    const slot = connectionSlot(apiOrigin);
    const raw = await access("readonly", (store) => store.get(slot), signal);
    if (raw === undefined) return null;
    const record = v.safeParse(
        v.object({ version: v.literal(1), iv: v.string(), data: v.pipe(v.string(), v.maxLength(32_000)) }),
        raw,
    );
    if (!record.success) throw new AppError("invalid_response");
    try {
        const data = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: fromBase64(record.output.iv),
                additionalData: new TextEncoder().encode(slot),
            },
            await vaultKey(signal),
            fromBase64(record.output.data),
        );
        const parsed = v.safeParse(connectionSchema, parseJson(new TextDecoder().decode(data)));
        if (!parsed.success || parsed.output.repository !== repositoryName(parsed.output.repository))
            throw new AppError("invalid_response");
        return parsed.output;
    } catch (cause) {
        if (signal.aborted) throw new AppError("cancelled", cause);
        throw new AppError("invalid_response", cause);
    }
}

export async function rememberChat(record: ChatRecovery, signal: AbortSignal): Promise<void> {
    await access(
        "readwrite",
        (store) => store.put(record, chatSlot(record.repository, record.request.userId)),
        signal,
    );
}

export async function recallChat(
    repository: string,
    userId: string,
    signal: AbortSignal,
): Promise<ChatRecovery | null> {
    const raw = await access("readonly", (store) => store.get(chatSlot(repository, userId)), signal);
    if (raw === undefined) return null;
    const parsed = v.safeParse(recoverySchema, raw);
    if (
        !parsed.success ||
        parsed.output.repository !== repositoryName(repository) ||
        parsed.output.request.userId !== userId ||
        parsed.output.key.publicKey !== parsed.output.request.publicKey ||
        parsed.output.key.privateKey.type !== "private" ||
        parsed.output.key.privateKey.extractable ||
        parsed.output.key.privateKey.algorithm.name !== "RSA-OAEP"
    )
        throw new AppError("invalid_response");
    return parsed.output;
}

export async function forgetChat(repository: string, userId: string, signal: AbortSignal): Promise<void> {
    await access("readwrite", (store) => store.delete(chatSlot(repository, userId)), signal);
}

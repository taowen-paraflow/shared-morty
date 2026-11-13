import * as v from "valibot";
import { AppError } from "./errors.ts";
import { loginErrorSchema, loginRequestSchema, sealedSchema } from "./login-protocol.ts";

export const CHAT_LIFETIME_MS = 60 * 60_000;
export const chatRequestSchema = v.object({
    ...loginRequestSchema.entries,
    purpose: v.literal("claude_chat"),
});
export type ChatRequest = Readonly<v.InferOutput<typeof chatRequestSchema>>;
export const chatMessageSchema = v.object({
    version: v.literal(1),
    purpose: v.literal("claude_chat"),
    requestId: v.pipe(v.string(), v.uuid()),
    runId: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/u)),
    attempt: v.pipe(v.number(), v.integer(), v.minValue(1)),
    expiresAt: v.pipe(v.number(), v.integer(), v.minValue(1)),
    kind: v.picklist(["ready", "error", "stopped"]),
    payload: sealedSchema,
});
export type ChatMessage = Readonly<Omit<v.InferOutput<typeof chatMessageSchema>, "payload">> & {
    readonly payload: Readonly<v.InferOutput<typeof sealedSchema>>;
};
export type ChatHeader = Omit<ChatMessage, "payload">;
export const chatStopSchema = v.object({
    version: v.literal(1),
    purpose: v.literal("claude_chat"),
    kind: v.literal("stop"),
    requestId: chatMessageSchema.entries.requestId,
    runId: chatMessageSchema.entries.runId,
    attempt: chatMessageSchema.entries.attempt,
    expiresAt: chatMessageSchema.entries.expiresAt,
});
export type ChatStop = Readonly<v.InferOutput<typeof chatStopSchema>>;
export const chatReadySchema = v.object({
    url: v.pipe(v.string(), v.maxLength(8192)),
    accessExpiresAt: v.pipe(v.string(), v.isoTimestamp()),
});
export const chatErrorSchema = v.object({
    code: v.union([
        loginErrorSchema.entries.code,
        v.picklist(["agent_failed", "shared_credential_missing", "morty_unavailable"]),
    ]),
});
export function chatContext(repository: string, issue: number, header: ChatHeader): string {
    return JSON.stringify({
        repository,
        issue,
        version: header.version,
        purpose: header.purpose,
        requestId: header.requestId,
        runId: header.runId,
        attempt: header.attempt,
        expiresAt: header.expiresAt,
        kind: header.kind,
    });
}
export function mortyUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw new AppError("invalid_response", cause);
    }
    const code = new URLSearchParams(url.hash.slice(1)).get("code");
    if (
        url.origin !== "https://morty.build" ||
        url.pathname !== "/continue" ||
        url.username ||
        url.password ||
        !code ||
        code.length > 4096 ||
        url.searchParams.get("harness") !== "claude" ||
        !v.safeParse(v.pipe(v.string(), v.uuid()), url.searchParams.get("sessionId")).success
    )
        throw new AppError("invalid_response");
    return url.href;
}

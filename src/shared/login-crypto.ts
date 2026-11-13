import * as v from "valibot";
import { AppError } from "./errors.ts";
import type { Sealed } from "./login-protocol.ts";
import { parseJson } from "./login-protocol.ts";

const RSA = { name: "RSA-OAEP", hash: "SHA-256" };

export function toBase64(value: ArrayBuffer | Uint8Array): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
    try {
        const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
        if (toBase64(bytes) !== value) throw new Error("Noncanonical base64");
        return bytes;
    } catch (cause) {
        throw new AppError("invalid_response", cause);
    }
}

export interface LoginKey {
    readonly publicKey: string;
    readonly privateKey: CryptoKey;
}

export async function createLoginKey(): Promise<LoginKey> {
    const pair = await crypto.subtle.generateKey(
        { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
        false,
        ["encrypt", "decrypt"],
    );
    return {
        publicKey: toBase64(await crypto.subtle.exportKey("spki", pair.publicKey)),
        privateKey: pair.privateKey,
    };
}

export async function seal(publicKey: string, value: unknown, context: string): Promise<Sealed> {
    try {
        const wrapper = await crypto.subtle.importKey("spki", fromBase64(publicKey), RSA, false, ["encrypt"]);
        const algorithm = v.safeParse(
            v.object({ modulusLength: v.pipe(v.number(), v.minValue(2048), v.maxValue(4096)) }),
            wrapper.algorithm,
        );
        if (!algorithm.success) throw new AppError("invalid_response");
        const raw = crypto.getRandomValues(new Uint8Array(32));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
            key,
            new TextEncoder().encode(JSON.stringify(value)),
        );
        const wrapped = await crypto.subtle.encrypt(RSA, wrapper, raw);
        raw.fill(0);
        return { key: toBase64(wrapped), iv: toBase64(iv), data: toBase64(data) };
    } catch (cause) {
        throw new AppError("invalid_response", cause);
    }
}

export async function open(privateKey: CryptoKey, payload: Sealed, context: string): Promise<unknown> {
    try {
        const iv = fromBase64(payload.iv);
        if (iv.length !== 12) throw new AppError("invalid_response");
        const raw = await crypto.subtle.decrypt(RSA, privateKey, fromBase64(payload.key));
        if (raw.byteLength !== 32) throw new AppError("invalid_response");
        const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
        new Uint8Array(raw).fill(0);
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
            key,
            fromBase64(payload.data),
        );
        return parseJson(new TextDecoder().decode(plain));
    } catch (cause) {
        throw new AppError("invalid_response", cause);
    }
}

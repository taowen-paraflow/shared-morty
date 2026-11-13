import * as v from "valibot";
import { AppError } from "./errors.ts";

export const LOGIN_VERSION = 1;
export const LOGIN_LIFETIME_MS = 15 * 60_000;
export const ACTIONS_BOT_ID = 41898282;
const positiveInteger = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
const base64 = v.pipe(v.string(), v.minLength(4), v.maxLength(16_384), v.regex(/^[A-Za-z0-9+/]+={0,2}$/u));

export const loginRequestSchema = v.object({
    version: v.literal(LOGIN_VERSION),
    requestId: v.pipe(v.string(), v.uuid()),
    userId: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/u)),
    publicKey: base64,
    expiresAt: positiveInteger,
});
export type LoginRequest = Readonly<v.InferOutput<typeof loginRequestSchema>>;

export const sealedSchema = v.object({ key: base64, iv: base64, data: base64 });
export type Sealed = Readonly<v.InferOutput<typeof sealedSchema>>;

export const loginMessageSchema = v.object({
    version: v.literal(LOGIN_VERSION),
    requestId: v.pipe(v.string(), v.uuid()),
    runId: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/u)),
    attempt: positiveInteger,
    expiresAt: positiveInteger,
    kind: v.picklist(["challenge", "code", "token", "error"]),
    payload: sealedSchema,
});
export type LoginMessage = Readonly<Omit<v.InferOutput<typeof loginMessageSchema>, "payload">> & {
    readonly payload: Sealed;
};
export type LoginHeader = Omit<LoginMessage, "payload">;

export const challengeSchema = v.object({ url: v.string(), publicKey: base64 });
export const codeSchema = v.object({ code: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_\-#.~]{10,2048}$/u)) });
export const tokenSchema = v.object({
    token: v.pipe(v.string(), v.regex(/^sk-ant-oat01-[A-Za-z0-9_-]{20,2048}$/u)),
});
export const loginErrorSchema = v.object({
    code: v.picklist([
        "provider_failed",
        "timeout",
        "cancelled",
        "unsafe_execution",
        "runner_busy",
        "conflict",
        "invalid_input",
        "unauthenticated",
        "forbidden",
        "repository_unavailable",
        "rate_limited",
        "invalid_response",
        "too_many_runs",
        "unavailable",
    ]),
});

export function parseJson(value: string): unknown {
    try {
        const result: unknown = JSON.parse(value);
        return result;
    } catch (cause) {
        throw new AppError("invalid_response", cause);
    }
}

export function authorizationUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw new AppError("invalid_response", cause);
    }
    if (
        url.protocol !== "https:" ||
        !["claude.ai", "claude.com"].includes(url.hostname) ||
        url.port ||
        url.username ||
        url.password ||
        !["/oauth/authorize", "/cai/oauth/authorize"].includes(url.pathname) ||
        url.hash ||
        value.length > 8192
    )
        throw new AppError("invalid_response");
    return url.href;
}

export function loginContext(repository: string, issue: number, header: LoginHeader): string {
    return JSON.stringify({
        repository,
        issue,
        version: header.version,
        requestId: header.requestId,
        runId: header.runId,
        attempt: header.attempt,
        expiresAt: header.expiresAt,
        kind: header.kind,
    });
}

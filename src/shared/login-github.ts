import * as v from "valibot";
import { AppError } from "./errors.ts";
import type { GitHubHttp } from "./github-http.ts";
import { githubRepositorySchema } from "./github-schema.ts";
import { fromBase64, toBase64 } from "./login-crypto.ts";
import {
    type LoginMessage,
    type LoginRequest,
    loginRequestSchema,
    parseJson,
    tokenSchema,
} from "./login-protocol.ts";

const identifier = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
const commentSchema = v.object({
    id: identifier,
    body: v.pipe(v.string(), v.maxLength(32_000)),
    user: v.nullable(v.object({ id: identifier, type: v.string() })),
});
export interface LoginComment {
    readonly id: number;
    readonly body: string;
    readonly user: { readonly id: number; readonly type: string } | null;
}

export class LoginGitHub {
    readonly #http: GitHubHttp;
    readonly #repository: string;
    constructor(http: GitHubHttp, repository: string) {
        this.#http = http;
        this.#repository = repository;
    }

    readonly settings = async (signal: AbortSignal) => {
        const parsed = v.safeParse(
            githubRepositorySchema,
            await this.#http.get(`/repos/${this.#repository}`, signal),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        if (parsed.output.full_name.toLowerCase() !== this.#repository)
            throw new AppError("unsafe_execution");
        return parsed.output;
    };

    readonly create = async (request: LoginRequest, signal: AbortSignal): Promise<number> => {
        const parsed = v.safeParse(
            v.object({ number: identifier }),
            await this.#http.post(
                `/repos/${this.#repository}/issues`,
                { title: `shared-morty-login-${request.requestId}`, body: JSON.stringify(request) },
                signal,
            ),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        return parsed.output.number;
    };

    readonly request = async (
        issue: number,
        userId: string,
        requestId: string,
        signal: AbortSignal,
    ): Promise<LoginRequest> => {
        const parsed = v.safeParse(
            v.object({
                title: v.string(),
                body: v.string(),
                user: v.nullable(v.object({ id: identifier })),
                state: v.string(),
                pull_request: v.optional(v.unknown()),
            }),
            await this.#http.get(`/repos/${this.#repository}/issues/${issue}`, signal),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        if (
            "pull_request" in parsed.output ||
            parsed.output.state !== "open" ||
            String(parsed.output.user?.id) !== userId ||
            parsed.output.title !== `shared-morty-login-${requestId}`
        )
            throw new AppError("forbidden");
        const data = v.safeParse(loginRequestSchema, parseJson(parsed.output.body));
        if (!data.success || data.output.userId !== userId || data.output.requestId !== requestId)
            throw new AppError("invalid_response");
        return data.output;
    };

    readonly dispatch = async (
        request: LoginRequest,
        issue: number,
        branch: string,
        signal: AbortSignal,
    ): Promise<void> => {
        await this.#http.post(
            `/repos/${this.#repository}/actions/workflows/login.yml/dispatches`,
            { ref: branch, inputs: { request_id: request.requestId, issue: String(issue) } },
            signal,
        );
    };

    readonly comments = async (issue: number, signal: AbortSignal): Promise<readonly LoginComment[]> => {
        const comments: LoginComment[] = [];
        for (let page = 1; page <= 10; page++) {
            const parsed = v.safeParse(
                v.pipe(v.array(commentSchema), v.maxLength(100)),
                await this.#http.get(
                    `/repos/${this.#repository}/issues/${issue}/comments?per_page=100&page=${page}`,
                    signal,
                ),
            );
            if (!parsed.success) throw new AppError("invalid_response");
            comments.push(...parsed.output);
            if (parsed.output.length < 100) return comments;
        }
        throw new AppError("invalid_response");
    };

    readonly send = async (issue: number, message: LoginMessage, signal: AbortSignal): Promise<void> => {
        await this.#http.post(
            `/repos/${this.#repository}/issues/${issue}/comments`,
            { body: JSON.stringify(message) },
            signal,
        );
    };

    readonly close = async (issue: number, signal: AbortSignal): Promise<void> => {
        await this.#http.patch(`/repos/${this.#repository}/issues/${issue}`, { state: "closed" }, signal);
    };

    readonly publicKey = async (signal: AbortSignal) => {
        const parsed = v.safeParse(
            v.object({
                key_id: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
                key: v.pipe(v.string(), v.maxLength(128)),
            }),
            await this.#http.get(`/repos/${this.#repository}/actions/secrets/public-key`, signal),
        );
        if (!parsed.success || fromBase64(parsed.output.key).length !== 32)
            throw new AppError("invalid_response");
        return parsed.output;
    };

    readonly shareClaude = async (token: string, signal: AbortSignal): Promise<void> => {
        if (!v.safeParse(tokenSchema, { token }).success) throw new AppError("invalid_input");
        await this.settings(signal);
        const key = await this.publicKey(signal);
        const { default: sodium } = await import("libsodium-wrappers");
        await sodium.ready;
        if (signal.aborted) throw new AppError("cancelled", signal.reason);
        const encrypted = sodium.crypto_box_seal(new TextEncoder().encode(token), fromBase64(key.key));
        await this.#http.put(
            `/repos/${this.#repository}/actions/secrets/SHARED_CLAUDE_TOKEN`,
            { key_id: key.key_id, encrypted_value: toBase64(encrypted) },
            signal,
        );
    };
}

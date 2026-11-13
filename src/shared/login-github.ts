import * as v from "valibot";
import { AppError } from "./errors.ts";
import type { GitHubHttp } from "./github-http.ts";
import { githubRepositorySchema } from "./github-schema.ts";
import { IssueGitHub } from "./issue-github.ts";
import { fromBase64, toBase64 } from "./login-crypto.ts";
import { type LoginMessage, type LoginRequest, loginRequestSchema, tokenSchema } from "./login-protocol.ts";

export class LoginGitHub {
    readonly #http: GitHubHttp;
    readonly #repository: string;
    readonly #issues: IssueGitHub;
    constructor(http: GitHubHttp, repository: string) {
        this.#http = http;
        this.#repository = repository;
        this.#issues = new IssueGitHub(http, repository);
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

    readonly create = (request: LoginRequest, signal: AbortSignal): Promise<number> =>
        this.#issues.create(`shared-morty-login-${request.requestId}`, request, signal);

    readonly request = async (
        issue: number,
        userId: string,
        requestId: string,
        signal: AbortSignal,
    ): Promise<LoginRequest> => {
        const data = v.safeParse(
            loginRequestSchema,
            await this.#issues.request(issue, `shared-morty-login-${requestId}`, userId, signal),
        );
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

    readonly comments = (issue: number, signal: AbortSignal) => this.#issues.comments(issue, signal);
    readonly send = (issue: number, message: LoginMessage, signal: AbortSignal) =>
        this.#issues.send(issue, message, signal);
    readonly close = (issue: number, signal: AbortSignal) => this.#issues.close(issue, signal);

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

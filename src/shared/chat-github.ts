import * as v from "valibot";
import { type ChatMessage, type ChatRequest, chatRequestSchema } from "./chat-protocol.ts";
import { AppError } from "./errors.ts";
import type { GitHubHttp } from "./github-http.ts";
import { githubRepositorySchema } from "./github-schema.ts";
import { IssueGitHub } from "./issue-github.ts";

export class ChatGitHub {
    readonly #http: GitHubHttp;
    readonly #repository: string;
    readonly #issues: IssueGitHub;
    constructor(http: GitHubHttp, repository: string) {
        this.#http = http;
        this.#repository = repository;
        this.#issues = new IssueGitHub(http, repository);
    }
    readonly create = (request: ChatRequest, signal: AbortSignal) =>
        this.#issues.create(`shared-morty-chat-${request.requestId}`, request, signal);
    readonly request = async (
        issue: number,
        userId: string,
        requestId: string,
        signal: AbortSignal,
    ): Promise<ChatRequest> => {
        const parsed = v.safeParse(
            chatRequestSchema,
            await this.#issues.request(issue, `shared-morty-chat-${requestId}`, userId, signal),
        );
        if (!parsed.success || parsed.output.userId !== userId || parsed.output.requestId !== requestId)
            throw new AppError("invalid_response");
        return parsed.output;
    };
    readonly settings = async (signal: AbortSignal) => {
        const repository = v.safeParse(
            githubRepositorySchema,
            await this.#http.get(`/repos/${this.#repository}`, signal),
        );
        if (!repository.success || repository.output.full_name.toLowerCase() !== this.#repository)
            throw new AppError("invalid_response");
        return repository.output;
    };
    readonly dispatch = async (request: ChatRequest, issue: number, signal: AbortSignal) => {
        const repository = await this.settings(signal);
        await this.#http.post(
            `/repos/${this.#repository}/actions/workflows/chat.yml/dispatches`,
            {
                ref: repository.default_branch,
                inputs: { request_id: request.requestId, issue: String(issue) },
            },
            signal,
        );
    };
    readonly comments = (issue: number, signal: AbortSignal) => this.#issues.comments(issue, signal);
    readonly send = (issue: number, message: ChatMessage, signal: AbortSignal) =>
        this.#issues.send(issue, message, signal);
    readonly close = (issue: number, signal: AbortSignal) => this.#issues.close(issue, signal);
}

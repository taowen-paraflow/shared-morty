import * as v from "valibot";
import { AppError } from "./errors.ts";
import type { GitHubHttp } from "./github-http.ts";
import { parseJson } from "./login-protocol.ts";

const identifier = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
const commentSchema = v.object({
    id: identifier,
    body: v.pipe(v.string(), v.maxLength(32_000)),
    user: v.nullable(v.object({ id: identifier, type: v.string() })),
});
export interface IssueComment {
    readonly id: number;
    readonly body: string;
    readonly user: { readonly id: number; readonly type: string } | null;
}

export class IssueGitHub {
    readonly #http: GitHubHttp;
    readonly #repository: string;
    constructor(http: GitHubHttp, repository: string) {
        this.#http = http;
        this.#repository = repository;
    }
    readonly create = async (title: string, body: unknown, signal: AbortSignal): Promise<number> => {
        const parsed = v.safeParse(
            v.object({ number: identifier }),
            await this.#http.post(
                `/repos/${this.#repository}/issues`,
                { title, body: JSON.stringify(body) },
                signal,
            ),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        return parsed.output.number;
    };
    readonly request = async (
        issue: number,
        title: string,
        userId: string,
        signal: AbortSignal,
    ): Promise<unknown> => {
        const parsed = v.safeParse(
            v.object({
                title: v.string(),
                body: v.pipe(v.string(), v.maxLength(32_000)),
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
            parsed.output.title !== title
        )
            throw new AppError("forbidden");
        return parseJson(parsed.output.body);
    };
    readonly comments = async (issue: number, signal: AbortSignal): Promise<readonly IssueComment[]> => {
        const comments: IssueComment[] = [];
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

    readonly send = async (issue: number, message: unknown, signal: AbortSignal): Promise<void> => {
        await this.#http.post(
            `/repos/${this.#repository}/issues/${issue}/comments`,
            { body: JSON.stringify(message) },
            signal,
        );
    };

    readonly close = async (issue: number, signal: AbortSignal): Promise<void> => {
        await this.#http.patch(`/repos/${this.#repository}/issues/${issue}`, { state: "closed" }, signal);
    };
}

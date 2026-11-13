import * as v from "valibot";
import { AppError } from "./errors.ts";
import {
    type ActiveRun,
    githubRunsSchema,
    githubUserSchema,
    type RunnerInspection,
    repositoryName,
    runnerState,
} from "./runner-status.ts";

const API_ORIGIN = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 10;

function apiOrigin(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw new AppError("invalid_input", cause);
    }
    const local = url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (
        (!local && url.origin !== API_ORIGIN) ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
    ) {
        throw new AppError("invalid_input");
    }
    return url.origin;
}

export class GitHubClient {
    readonly #origin: string;
    readonly #token: string;

    constructor(token: string, origin = API_ORIGIN) {
        if (token.trim().length === 0 || /[\r\n]/u.test(token)) throw new AppError("invalid_input");
        this.#token = token.trim();
        this.#origin = apiOrigin(origin);
    }

    readonly inspectRunner = async (repository: string, signal: AbortSignal): Promise<RunnerInspection> => {
        const name = repositoryName(repository);
        const parsedUser = v.safeParse(githubUserSchema, await this.#get("/user", signal));
        if (!parsedUser.success) throw new AppError("invalid_response");
        const user = { id: String(parsedUser.output.id), login: parsedUser.output.login };
        const runs = new Map<number, ActiveRun>();
        for (let page = 1; page <= MAX_PAGES; page++) {
            const query = new URLSearchParams({
                actor: user.login,
                event: "workflow_dispatch",
                per_page: "100",
                page: String(page),
            });
            const parsed = v.safeParse(
                githubRunsSchema,
                await this.#get(`/repos/${name}/actions/runs?${query}`, signal),
            );
            if (!parsed.success) throw new AppError("invalid_response");
            if (parsed.output.total_count > 1000) throw new AppError("too_many_runs");
            for (const run of parsed.output.workflow_runs) {
                const workflow = run.path.split("@")[0];
                if (
                    run.actor?.id === parsedUser.output.id &&
                    run.display_title.startsWith(`shared-morty-${user.id}-`) &&
                    (workflow === ".github/workflows/runner.yml" ||
                        workflow === ".github/workflows/login.yml") &&
                    run.status !== "completed"
                ) {
                    runs.set(run.id, {
                        id: run.id,
                        status: run.status,
                        url: `https://github.com/${name}/actions/runs/${run.id}`,
                    });
                }
            }
            if (page * 100 >= parsed.output.total_count)
                return { user, runner: runnerState([...runs.values()]) };
        }
        throw new AppError("too_many_runs");
    };

    readonly checkEnvironment = async (repository: string, signal: AbortSignal): Promise<void> => {
        const name = repositoryName(repository);
        const inspection = await this.inspectRunner(name, signal);
        if (inspection.runner.kind !== "idle") throw new AppError("runner_busy");
        const parsed = v.safeParse(
            v.object({ default_branch: v.pipe(v.string(), v.minLength(1), v.maxLength(255)) }),
            await this.#get(`/repos/${name}`, signal),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        await this.#request(`/repos/${name}/actions/workflows/runner.yml/dispatches`, signal, {
            ref: parsed.output.default_branch,
            inputs: { request_id: crypto.randomUUID(), mode: "check" },
        });
    };

    readonly verifyExecution = async (
        input: {
            readonly repository: string;
            readonly runId: string;
            readonly userId: string;
            readonly ref: string;
            readonly requestId: string;
        },
        signal: AbortSignal,
    ): Promise<void> => {
        if (!/^[1-9][0-9]*$/u.test(input.runId) || !/^[1-9][0-9]*$/u.test(input.userId))
            throw new AppError("unsafe_execution");
        const name = repositoryName(input.repository);
        const repository = v.safeParse(
            v.object({ private: v.boolean(), full_name: v.string(), default_branch: v.string() }),
            await this.#get(`/repos/${name}`, signal),
        );
        const run = v.safeParse(
            v.object({
                actor: v.object({
                    id: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER)),
                }),
                event: v.string(),
                head_branch: v.string(),
                path: v.string(),
                display_title: v.string(),
            }),
            await this.#get(`/repos/${name}/actions/runs/${input.runId}`, signal),
        );
        if (!repository.success || !run.success) throw new AppError("invalid_response");
        if (
            !repository.output.private ||
            repository.output.full_name.toLowerCase() !== name ||
            input.ref !== `refs/heads/${repository.output.default_branch}` ||
            run.output.head_branch !== repository.output.default_branch ||
            run.output.event !== "workflow_dispatch" ||
            run.output.path.split("@")[0] !== ".github/workflows/runner.yml" ||
            String(run.output.actor.id) !== input.userId ||
            run.output.display_title !== `shared-morty-${input.userId}-${input.requestId}`
        )
            throw new AppError("unsafe_execution");
    };

    readonly cancelRunner = async (repository: string, runId: number, signal: AbortSignal): Promise<void> => {
        if (!Number.isSafeInteger(runId) || runId < 1) throw new AppError("invalid_input");
        const name = repositoryName(repository);
        const inspection = await this.inspectRunner(name, signal);
        const runner = inspection.runner;
        const owned = runner.kind === "active" ? [runner.run] : runner.kind === "conflict" ? runner.runs : [];
        if (!owned.some((run) => run.id === runId)) throw new AppError("forbidden");
        await this.#request(`/repos/${name}/actions/runs/${runId}/cancel`, signal, {});
    };

    readonly #get = async (pathname: string, signal: AbortSignal): Promise<unknown> =>
        this.#request(pathname, signal);

    readonly #request = async (
        pathname: string,
        signal: AbortSignal,
        body?: Readonly<Record<string, unknown>>,
    ): Promise<unknown> => {
        if (signal.aborted) throw new AppError("cancelled", signal.reason);
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
        const combined = AbortSignal.any([signal, deadline.signal]);
        try {
            const response = await fetch(new URL(pathname, this.#origin), {
                method: body === undefined ? "GET" : "POST",
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                headers: {
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                    accept: "application/vnd.github+json",
                    authorization: `Bearer ${this.#token}`,
                    "x-github-api-version": "2022-11-28",
                },
                redirect: "error",
                signal: combined,
            });
            if (!response.ok) {
                await response.body?.cancel();
                switch (response.status) {
                    case 401:
                        throw new AppError("unauthenticated");
                    case 403:
                        throw new AppError("forbidden");
                    case 404:
                        throw new AppError("repository_unavailable");
                    case 429:
                        throw new AppError("rate_limited");
                    case 409:
                    case 422:
                        throw new AppError("conflict");
                    default:
                        throw new AppError("unavailable");
                }
            }
            if (response.status === 204 || response.status === 202) {
                await response.body?.cancel();
                return null;
            }
            const text = await response.text();
            if (text.length > 2_000_000) throw new AppError("invalid_response");
            try {
                const value: unknown = JSON.parse(text);
                return value;
            } catch (cause) {
                throw new AppError("invalid_response", cause);
            }
        } catch (cause) {
            if (signal.aborted) throw new AppError("cancelled", cause);
            if (deadline.signal.aborted) throw new AppError("timeout", cause);
            if (cause instanceof AppError) throw cause;
            throw new AppError("unavailable", cause);
        } finally {
            clearTimeout(timer);
        }
    };
}

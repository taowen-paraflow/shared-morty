import * as v from "valibot";
import { ChatGitHub } from "./chat-github.ts";
import { AppError } from "./errors.ts";
import { GitHubHttp } from "./github-http.ts";
import {
    githubDefaultBranchSchema,
    githubExecutionRunSchema,
    githubRepositorySchema,
    githubRunsSchema,
    githubUserSchema,
} from "./github-schema.ts";
import { LoginGitHub } from "./login-github.ts";
import {
    type ActiveRun,
    type RunnerInspection,
    repositoryName,
    runnerState,
    type UserIdentity,
} from "./runner-status.ts";

const MAX_PAGES = 10;

export class GitHubClient {
    readonly #http: GitHubHttp;

    constructor(token: string, origin?: string) {
        this.#http = new GitHubHttp(token, origin);
    }

    readonly chatChannel = (repository: string): ChatGitHub =>
        new ChatGitHub(this.#http, repositoryName(repository));

    readonly loginChannel = (repository: string): LoginGitHub =>
        new LoginGitHub(this.#http, repositoryName(repository));

    async #user(signal: AbortSignal): Promise<UserIdentity> {
        const parsed = v.safeParse(githubUserSchema, await this.#http.get("/user", signal));
        if (!parsed.success) throw new AppError("invalid_response");
        return { id: String(parsed.output.id), login: parsed.output.login };
    }

    readonly connectRepository = async (repository: string, signal: AbortSignal) => {
        const name = repositoryName(repository);
        const user = await this.#user(signal);
        const parsed = v.safeParse(githubRepositorySchema, await this.#http.get(`/repos/${name}`, signal));
        if (!parsed.success || parsed.output.full_name.toLowerCase() !== name)
            throw new AppError("invalid_response");
        return { repository: name, user };
    };

    async #ownedRuns(repository: string, signal: AbortSignal) {
        const name = repositoryName(repository);
        const user = await this.#user(signal);
        const runs = new Map<
            number,
            Readonly<v.InferOutput<typeof githubRunsSchema>["workflow_runs"][number]>
        >();
        for (let page = 1; page <= MAX_PAGES; page++) {
            const query = new URLSearchParams({
                actor: user.login,
                event: "workflow_dispatch",
                per_page: "100",
                page: String(page),
            });
            const parsed = v.safeParse(
                githubRunsSchema,
                await this.#http.get(`/repos/${name}/actions/runs?${query}`, signal),
            );
            if (!parsed.success) throw new AppError("invalid_response");
            if (parsed.output.total_count > 1000) throw new AppError("too_many_runs");
            for (const run of parsed.output.workflow_runs) {
                const workflow = run.path.split("@")[0];
                if (
                    String(run.actor?.id) === user.id &&
                    run.display_title.startsWith(`shared-morty-${user.id}-`) &&
                    (workflow === ".github/workflows/runner.yml" ||
                        workflow === ".github/workflows/login.yml" ||
                        workflow === ".github/workflows/chat.yml")
                ) {
                    runs.set(run.id, run);
                }
            }
            if (page * 100 >= parsed.output.total_count) return { user, runs: [...runs.values()] };
        }
        throw new AppError("too_many_runs");
    }

    readonly inspectRunner = async (repository: string, signal: AbortSignal): Promise<RunnerInspection> => {
        const name = repositoryName(repository);
        const { user, runs } = await this.#ownedRuns(name, signal);
        const active: ActiveRun[] = runs
            .filter((run) => run.status !== "completed")
            .map((run) => ({
                id: run.id,
                status: run.status,
                url: `https://github.com/${name}/actions/runs/${run.id}`,
            }));
        return { user, runner: runnerState(active) };
    };

    readonly findChatExecution = async (
        repository: string,
        requestId: string,
        userId: string,
        signal: AbortSignal,
    ) => {
        const name = repositoryName(repository);
        const { user, runs } = await this.#ownedRuns(name, signal);
        if (user.id !== userId) throw new AppError("forbidden");
        const matches = runs.filter(
            (run) =>
                run.path.split("@")[0] === ".github/workflows/chat.yml" &&
                run.display_title === `shared-morty-${user.id}-${requestId}`,
        );
        if (matches.length > 1) throw new AppError("unsafe_execution");
        const run = matches[0];
        return run
            ? ({
                  kind: "found",
                  status: run.status,
                  conclusion: run.conclusion ?? null,
                  id: run.id,
              } satisfies {
                  readonly kind: "found";
                  readonly status: string;
                  readonly conclusion: string | null;
                  readonly id: number;
              })
            : ({ kind: "missing" } satisfies { readonly kind: "missing" });
    };

    readonly checkEnvironment = async (repository: string, signal: AbortSignal): Promise<void> => {
        const name = repositoryName(repository);
        const inspection = await this.inspectRunner(name, signal);
        if (inspection.runner.kind !== "idle") throw new AppError("runner_busy");
        const parsed = v.safeParse(githubDefaultBranchSchema, await this.#http.get(`/repos/${name}`, signal));
        if (!parsed.success) throw new AppError("invalid_response");
        await this.#http.post(
            `/repos/${name}/actions/workflows/runner.yml/dispatches`,
            {
                ref: parsed.output.default_branch,
                inputs: { request_id: crypto.randomUUID(), mode: "check" },
            },
            signal,
        );
    };

    readonly verifyExecution = async (
        input: {
            readonly repository: string;
            readonly runId: string;
            readonly userId: string;
            readonly ref: string;
            readonly requestId: string;
            readonly workflow?: "runner" | "login" | "chat";
            readonly attempt?: number;
        },
        signal: AbortSignal,
    ): Promise<number | undefined> => {
        if (!/^[1-9][0-9]*$/u.test(input.runId) || !/^[1-9][0-9]*$/u.test(input.userId))
            throw new AppError("unsafe_execution");
        const name = repositoryName(input.repository);
        const repository = v.safeParse(
            githubRepositorySchema,
            await this.#http.get(`/repos/${name}`, signal),
        );
        const run = v.safeParse(
            githubExecutionRunSchema,
            await this.#http.get(`/repos/${name}/actions/runs/${input.runId}`, signal),
        );
        if (!repository.success || !run.success) throw new AppError("invalid_response");
        if (
            repository.output.full_name.toLowerCase() !== name ||
            input.ref !== `refs/heads/${repository.output.default_branch}` ||
            run.output.head_branch !== repository.output.default_branch ||
            run.output.event !== "workflow_dispatch" ||
            run.output.path.split("@")[0] !== `.github/workflows/${input.workflow ?? "runner"}.yml` ||
            (input.attempt !== undefined && run.output.run_attempt !== input.attempt) ||
            String(run.output.actor.id) !== input.userId ||
            run.output.display_title !== `shared-morty-${input.userId}-${input.requestId}`
        )
            throw new AppError("unsafe_execution");
        return run.output.run_attempt;
    };

    readonly cancelRunner = async (repository: string, runId: number, signal: AbortSignal): Promise<void> => {
        if (!Number.isSafeInteger(runId) || runId < 1) throw new AppError("invalid_input");
        const name = repositoryName(repository);
        const inspection = await this.inspectRunner(name, signal);
        const runner = inspection.runner;
        const owned = runner.kind === "active" ? [runner.run] : runner.kind === "conflict" ? runner.runs : [];
        if (!owned.some((run) => run.id === runId)) throw new AppError("forbidden");
        await this.#http.post(`/repos/${name}/actions/runs/${runId}/cancel`, {}, signal);
    };
}

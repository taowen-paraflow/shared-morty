import type { AppError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import type { RunnerInspection } from "../shared/runner-status.ts";

export interface Session {
    readonly client: GitHubClient;
    readonly repository: string;
    readonly inspection: RunnerInspection;
}

export type LauncherState =
    | { readonly kind: "disconnected" }
    | { readonly kind: "connecting"; readonly request: AbortController }
    | { readonly kind: "ready"; readonly session: Session }
    | { readonly kind: "needs_refresh"; readonly session: Session; readonly notice: string }
    | { readonly kind: "working"; readonly request: AbortController }
    | { readonly kind: "failed"; readonly error: AppError };

export type LauncherAction =
    | { readonly kind: "refresh" }
    | { readonly kind: "check" }
    | { readonly kind: "cancel"; readonly runId: number };

export interface ConnectionInput {
    readonly repository: string;
    readonly token: string;
}

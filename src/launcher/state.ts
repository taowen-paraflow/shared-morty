import type { AppError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import type { RunnerInspection } from "../shared/runner-status.ts";
import type { ClaudeLoginState } from "./claude-login.ts";

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
    | { readonly kind: "claude_login"; readonly session: Session; readonly login: ClaudeLoginState }
    | { readonly kind: "failed"; readonly error: AppError };

export type LauncherAction =
    | { readonly kind: "login_claude" }
    | { readonly kind: "login_refresh" }
    | { readonly kind: "login_code"; readonly code: string }
    | { readonly kind: "share_claude" }
    | { readonly kind: "login_back" }
    | { readonly kind: "login_cancel" }
    | { readonly kind: "refresh" }
    | { readonly kind: "check" }
    | { readonly kind: "cancel"; readonly runId: number };

export interface ConnectionInput {
    readonly repository: string;
    readonly token: string;
}

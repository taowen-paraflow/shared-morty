import type { AppError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import { assertNever, type RunnerInspection } from "../shared/runner-status.ts";
import type { ClaudeLoginState } from "./claude-login.ts";

export interface Session {
    readonly client: GitHubClient;
    readonly repository: string;
    readonly inspection: RunnerInspection;
}

export type ConnectedState =
    | { readonly kind: "ready"; readonly session: Session }
    | { readonly kind: "needs_refresh"; readonly session: Session; readonly notice: string }
    | { readonly kind: "claude_login"; readonly session: Session; readonly login: ClaudeLoginState };

export type SettledState =
    | { readonly kind: "disconnected" }
    | { readonly kind: "failed"; readonly error: AppError }
    | ConnectedState;

export type LauncherState =
    | SettledState
    | { readonly kind: "connecting"; readonly operationId: number }
    | { readonly kind: "working"; readonly operationId: number; readonly previous: ConnectedState };

type LauncherEvent =
    | { readonly kind: "connecting"; readonly operationId: number }
    | { readonly kind: "working"; readonly operationId: number }
    | { readonly kind: "finished"; readonly operationId: number; readonly next: SettledState };

export function isConnected(state: LauncherState): state is ConnectedState {
    switch (state.kind) {
        case "ready":
        case "needs_refresh":
        case "claude_login":
            return true;
        case "disconnected":
        case "failed":
        case "connecting":
        case "working":
            return false;
        default:
            return assertNever(state);
    }
}

export function launcherReducer(state: LauncherState, event: LauncherEvent): LauncherState {
    switch (event.kind) {
        case "connecting":
            return { kind: "connecting", operationId: event.operationId };
        case "working":
            return isConnected(state)
                ? { kind: "working", operationId: event.operationId, previous: state }
                : state;
        case "finished":
            return (state.kind === "connecting" || state.kind === "working") &&
                state.operationId === event.operationId
                ? event.next
                : state;
        default:
            return assertNever(event);
    }
}

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

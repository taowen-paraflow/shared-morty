import type { AppError } from "../shared/errors.ts";
import { assertNever } from "../shared/runner-status.ts";
import {
    beginClaudeLogin,
    type ClaudeLoginState,
    cancelClaudeLogin,
    refreshClaudeLogin,
    sendClaudeCode,
} from "./claude-login.ts";
import type { ConnectedState, LauncherAction, Session } from "./state.ts";

export type LauncherOperation = (signal: AbortSignal) => Promise<ConnectedState>;

function loginOperation(
    session: Session,
    run: (signal: AbortSignal) => Promise<ClaudeLoginState>,
): LauncherOperation {
    return async (signal) => ({ kind: "claude_login", session, login: await run(signal) });
}

function refreshRunner(session: Session): LauncherOperation {
    return async (signal) => ({
        kind: "ready",
        session: { ...session, inspection: await session.client.inspectRunner(session.repository, signal) },
    });
}

export function planOperation(state: ConnectedState, action: LauncherAction): LauncherOperation | undefined {
    const { session } = state;
    switch (action.kind) {
        case "refresh":
            return state.kind === "claude_login" ? undefined : refreshRunner(session);
        case "login_back":
            return state.kind === "claude_login" &&
                (state.login.kind === "shared" || state.login.kind === "failed")
                ? refreshRunner(session)
                : undefined;
        case "check":
            if (state.kind !== "ready" || session.inspection.runner.kind !== "idle") return undefined;
            return async (signal) => {
                await session.client.checkEnvironment(session.repository, signal);
                return {
                    kind: "needs_refresh",
                    session,
                    notice: "检查任务已提交，请刷新状态。检查通过不表示聊天已可用。",
                };
            };
        case "cancel":
            if (state.kind === "claude_login") return undefined;
            return async (signal) => {
                await session.client.cancelRunner(session.repository, action.runId, signal);
                return {
                    kind: "needs_refresh",
                    session,
                    notice: "停止请求已提交，请刷新状态。尚未确认结束，未保存个人数据。",
                };
            };
        case "login_claude":
            if (state.kind !== "ready" || session.inspection.runner.kind !== "idle") return undefined;
            return loginOperation(session, (signal) =>
                beginClaudeLogin(session.client, session.repository, signal),
            );
        case "login_refresh": {
            if (state.kind !== "claude_login") return undefined;
            const { login } = state;
            if (login.kind !== "waiting" && login.kind !== "waiting_token") return undefined;
            return loginOperation(session, (signal) => refreshClaudeLogin(session.client, login, signal));
        }
        case "login_code": {
            if (state.kind !== "claude_login" || state.login.kind !== "authorizing") return undefined;
            const { login } = state;
            return loginOperation(session, (signal) => sendClaudeCode(login, action.code, signal));
        }
        case "share_claude": {
            if (state.kind !== "claude_login" || state.login.kind !== "authorized") return undefined;
            const { login } = state;
            return loginOperation(session, async (signal) => {
                await login.context.channel.shareClaude(login.token, signal);
                return { kind: "shared" };
            });
        }
        case "login_cancel": {
            if (state.kind !== "claude_login") return undefined;
            const { login } = state;
            if (login.kind === "shared" || login.kind === "failed") return undefined;
            return loginOperation(session, (signal) => cancelClaudeLogin(session.client, login, signal));
        }
        default:
            return assertNever(action);
    }
}

export function recoverOperation(previous: ConnectedState, error: AppError): ConnectedState {
    if (previous.kind === "claude_login" && previous.login.kind !== "shared") {
        return { ...previous, login: { ...previous.login, notice: error.message } };
    }
    return {
        kind: "needs_refresh",
        session: previous.session,
        notice: `${error.message} 如已提交任务，请先刷新状态再重试。`,
    };
}

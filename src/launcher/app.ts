import { publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import { assertNever } from "../shared/runner-status.ts";
import { beginClaudeLogin, cancelClaudeLogin, refreshClaudeLogin, sendClaudeCode } from "./claude-login.ts";
import type { ConnectionInput, LauncherAction, LauncherState } from "./state.ts";
import { createLauncherView } from "./view.ts";

interface LauncherOptions {
    readonly apiOrigin?: string;
}

export function mountLauncher(root: HTMLElement, options: LauncherOptions = {}): () => void {
    const lifetime = new AbortController();
    let state: LauncherState = { kind: "disconnected" };

    const transition = (next: LauncherState) => {
        state = next;
        view.render(state);
    };
    const operate = async (action: LauncherAction) => {
        if (state.kind !== "ready" && state.kind !== "needs_refresh" && state.kind !== "claude_login") return;
        if ((action.kind === "check" || action.kind === "login_claude") && state.kind !== "ready") return;
        const previous = state;
        const session = state.session;
        const request = new AbortController();
        const signal = AbortSignal.any([lifetime.signal, request.signal]);
        transition({ kind: "working", request });
        try {
            switch (action.kind) {
                case "login_claude": {
                    const login = await beginClaudeLogin(session.client, session.repository, signal);
                    if (!signal.aborted) transition({ kind: "claude_login", session, login });
                    return;
                }
                case "login_refresh": {
                    if (previous.kind !== "claude_login") {
                        transition(previous);
                        return;
                    }
                    const login = await refreshClaudeLogin(session.client, previous.login, signal);
                    if (!signal.aborted) transition({ kind: "claude_login", session, login });
                    return;
                }
                case "login_code": {
                    if (previous.kind !== "claude_login" || previous.login.kind !== "authorizing") {
                        transition(previous);
                        return;
                    }
                    const login = await sendClaudeCode(previous.login, action.code, signal);
                    if (!signal.aborted) transition({ kind: "claude_login", session, login });
                    return;
                }
                case "share_claude": {
                    if (previous.kind !== "claude_login" || previous.login.kind !== "authorized") {
                        transition(previous);
                        return;
                    }
                    await previous.login.context.channel.shareClaude(previous.login.token, signal);
                    if (!signal.aborted)
                        transition({ kind: "claude_login", session, login: { kind: "shared" } });
                    return;
                }
                case "login_cancel": {
                    if (previous.kind !== "claude_login") {
                        transition(previous);
                        return;
                    }
                    const login = await cancelClaudeLogin(session.client, previous.login, signal);
                    if (!signal.aborted) transition({ kind: "claude_login", session, login });
                    return;
                }
                case "login_back":
                case "refresh": {
                    const inspection = await session.client.inspectRunner(session.repository, signal);
                    if (!signal.aborted) transition({ kind: "ready", session: { ...session, inspection } });
                    return;
                }
                case "check":
                    await session.client.checkEnvironment(session.repository, signal);
                    if (!signal.aborted)
                        transition({
                            kind: "needs_refresh",
                            session,
                            notice: "检查任务已提交，请刷新状态。检查通过不表示聊天已可用。",
                        });
                    return;
                case "cancel":
                    await session.client.cancelRunner(session.repository, action.runId, signal);
                    if (!signal.aborted)
                        transition({
                            kind: "needs_refresh",
                            session,
                            notice: "停止请求已提交，请刷新状态。尚未确认结束，未保存个人数据。",
                        });
                    return;
                default:
                    return assertNever(action);
            }
        } catch (cause) {
            if (!signal.aborted && previous.kind === "claude_login" && previous.login.kind !== "shared") {
                transition({ ...previous, login: { ...previous.login, notice: publicError(cause).message } });
                return;
            }
            if (!signal.aborted)
                transition({
                    kind: "needs_refresh",
                    session,
                    notice: `${publicError(cause).message} 如已提交任务，请先刷新状态再重试。`,
                });
        }
    };
    const connect = async (input: ConnectionInput) => {
        if (state.kind === "connecting" || state.kind === "working") state.request.abort();
        const request = new AbortController();
        transition({ kind: "connecting", request });
        const signal = AbortSignal.any([lifetime.signal, request.signal]);
        try {
            const client = new GitHubClient(input.token, options.apiOrigin);
            const inspection = await client.inspectRunner(input.repository, signal);
            if (!signal.aborted)
                transition({ kind: "ready", session: { client, repository: input.repository, inspection } });
        } catch (cause) {
            if (!signal.aborted) transition({ kind: "failed", error: publicError(cause) });
        }
    };
    const view = createLauncherView(
        root,
        (input) => {
            void connect(input);
        },
        (action) => {
            void operate(action);
        },
    );
    view.render(state);
    return () => {
        lifetime.abort();
        view.dispose();
    };
}

import { useState } from "react";
import type { AppError } from "../shared/errors.ts";
import {
    beginClaudeLogin,
    type ClaudeLoginState,
    cancelClaudeLogin,
    refreshClaudeLogin,
    sendClaudeCode,
} from "./claude-login.ts";
import { type ClaudeActions, ClaudeLoginPanel } from "./claude-login-panel.tsx";
import type { Session } from "./connection.ts";
import { useTask } from "./use-task.ts";

type Settled = { readonly kind: "intro" } | { readonly kind: "login"; readonly login: ClaudeLoginState };
type SharingState = Settled | { readonly kind: "working"; readonly previous: Settled };

export function ClaudeSharingPage({
    session,
    lifetime,
    hidden,
}: {
    readonly session: Session;
    readonly lifetime: AbortSignal;
    readonly hidden: boolean;
}) {
    const [state, setState] = useState<SharingState>({ kind: "intro" });
    const run = useTask(lifetime);
    const screen = state.kind === "working" ? state.previous : state;
    const execute = (operation: (signal: AbortSignal) => Promise<ClaudeLoginState>) => {
        if (state.kind === "working") return;
        const previous = state;
        const failed = (error: AppError) => {
            const login =
                previous.kind === "login" && previous.login.kind !== "shared"
                    ? { ...previous.login, notice: error.message }
                    : ({ kind: "failed", notice: error.message } satisfies ClaudeLoginState);
            setState({ kind: "login", login });
        };
        run(operation, {
            started: () => setState({ kind: "working", previous }),
            succeeded: (login) => setState({ kind: "login", login }),
            failed,
        });
    };
    const login = screen.kind === "login" ? screen.login : undefined;
    const actions: ClaudeActions = {
        refresh: () => {
            if (login) execute((signal) => refreshClaudeLogin(session.client, login, signal));
        },
        submitCode: (code) => {
            if (login?.kind === "authorizing") execute((signal) => sendClaudeCode(login, code, signal));
        },
        publish: () => {
            if (login?.kind === "authorized")
                execute(async (signal) => {
                    await login.context.channel.shareClaude(login.token, signal);
                    return { kind: "shared" };
                });
        },
        cancel: () => {
            if (login && login.kind !== "shared" && login.kind !== "failed")
                execute((signal) => cancelClaudeLogin(session.client, login, signal));
        },
        reset: () => {
            if (state.kind === "login" && (state.login.kind === "shared" || state.login.kind === "failed"))
                setState({ kind: "intro" });
        },
    };
    return (
        <section hidden={hidden} role="status" aria-live="polite" aria-busy={state.kind === "working"}>
            <h2>共享我的 Claude Code 账号</h2>
            <p>为团队提供你自己的 Claude Code 账号。需要此仓库的 Actions Secrets 写入权限。</p>
            <p>切换功能可继续授权；刷新页面或更换 GitHub 连接会丢弃尚未共享的授权结果。</p>
            {screen.kind === "intro" ? (
                <button
                    type="button"
                    disabled={state.kind === "working"}
                    onClick={() =>
                        execute((signal) => beginClaudeLogin(session.client, session.repository, signal))
                    }
                >
                    开始 Claude 授权
                </button>
            ) : (
                <ClaudeLoginPanel login={screen.login} busy={state.kind === "working"} actions={actions} />
            )}
        </section>
    );
}

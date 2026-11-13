import { assertNever } from "../shared/runner-status.ts";
import { ClaudeLoginPanel } from "./claude-login-panel.tsx";
import { ConnectionForm } from "./connection-form.tsx";
import { RunnerPanel } from "./runner-panel.tsx";
import type { LauncherAction, LauncherState } from "./state.ts";
import { type LauncherOptions, useLauncher } from "./use-launcher.ts";

interface ScreenProps {
    readonly state: Exclude<LauncherState, { readonly kind: "working" }>;
    readonly busy: boolean;
    readonly onAction: (action: LauncherAction) => void;
}

function Screen({ state, busy, onAction }: ScreenProps) {
    switch (state.kind) {
        case "disconnected":
            return <p>尚未连接 GitHub。</p>;
        case "connecting":
            return <p>正在确认身份与运行状态…</p>;
        case "failed":
            return <p>{state.error.message}</p>;
        case "claude_login":
            return (
                <>
                    <p>已连接 {state.session.inspection.user.login}</p>
                    <ClaudeLoginPanel login={state.login} busy={busy} onAction={onAction} />
                </>
            );
        case "ready":
        case "needs_refresh":
            return (
                <>
                    <p>已连接 {state.session.inspection.user.login}</p>
                    {state.kind === "needs_refresh" && <p>{state.notice}</p>}
                    <button type="button" disabled={busy} onClick={() => onAction({ kind: "refresh" })}>
                        刷新状态
                    </button>
                    <RunnerPanel
                        runner={state.session.inspection.runner}
                        snapshot={state.kind === "ready" ? "verified" : "stale"}
                        busy={busy}
                        onAction={onAction}
                    />
                </>
            );
        default:
            return assertNever(state);
    }
}

export function Launcher({
    options,
    lifetime,
}: {
    readonly options: LauncherOptions;
    readonly lifetime: AbortSignal;
}) {
    const { state, connect, act } = useLauncher(options, lifetime);
    const screen = state.kind === "working" ? state.previous : state;
    const busy = state.kind === "working" || state.kind === "connecting";
    return (
        <>
            <header>
                <p className="eyebrow">SHARED MORTY</p>
                <h1>你的环境，你的对话。</h1>
                <p>连接 GitHub，查看属于你的运行环境。</p>
            </header>
            <ConnectionForm onConnect={connect} />
            <section role="status" aria-live="polite" aria-busy={busy}>
                {state.kind === "working" && <p>正在处理，请稍候…</p>}
                <Screen state={screen} busy={busy} onAction={act} />
            </section>
        </>
    );
}

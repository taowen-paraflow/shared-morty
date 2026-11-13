import { useEffect } from "react";
import { ChatPanel } from "./chat-panel.tsx";
import type { Session } from "./connection.ts";
import { RunnerPanel } from "./runner-panel.tsx";
import { useChat } from "./use-chat.ts";
import { useRunner } from "./use-runner.ts";

export function UsagePage({
    session,
    lifetime,
    hidden,
}: {
    readonly session: Session;
    readonly lifetime: AbortSignal;
    readonly hidden: boolean;
}) {
    const { screen, busy, refresh, act } = useRunner(session, lifetime);
    const chat = useChat(session, lifetime);
    useEffect(() => {
        if (!hidden && !chat.ownsRunner) refresh();
    }, [refresh, hidden, chat.ownsRunner]);
    return (
        <section hidden={hidden} role="status" aria-live="polite" aria-busy={busy || chat.busy}>
            <h2>使用团队共享账号</h2>
            <p>使用团队提供的账号，无需再次登录 Claude。</p>
            <ChatPanel
                chat={chat}
                canStart={!busy && screen.kind === "ready" && screen.inspection.runner.kind === "idle"}
            />
            <h3>我的运行任务</h3>
            <p>每人同时只能运行一个任务，账号授权和运行环境检查共用此限制。</p>
            <button type="button" disabled={busy} onClick={refresh}>
                刷新状态
            </button>
            {screen.kind === "loading" ? (
                <p>正在确认运行状态…</p>
            ) : screen.kind === "failed" ? (
                <p>{screen.notice}</p>
            ) : (
                <>
                    {screen.kind === "stale" && <p>{screen.notice}</p>}
                    {!chat.ownsRunner && (
                        <RunnerPanel
                            runner={screen.inspection.runner}
                            snapshot={screen.kind === "ready" ? "verified" : "stale"}
                            busy={busy}
                            onAction={act}
                        />
                    )}
                </>
            )}
        </section>
    );
}

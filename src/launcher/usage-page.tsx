import { useCallback, useEffect, useState } from "react";
import type { RunnerInspection } from "../shared/runner-status.ts";
import { ChatPanel } from "./chat-panel.tsx";
import type { Session } from "./connection.ts";
import { RunnerPanel } from "./runner-panel.tsx";
import { useChat } from "./use-chat.ts";
import { useTask } from "./use-task.ts";

export type RunnerAction = { readonly kind: "check" } | { readonly kind: "cancel"; readonly runId: number };
type Snapshot =
    | { readonly kind: "ready"; readonly inspection: RunnerInspection }
    | { readonly kind: "stale"; readonly inspection: RunnerInspection; readonly notice: string };
type UsageState =
    | Snapshot
    | { readonly kind: "loading" }
    | { readonly kind: "failed"; readonly notice: string }
    | { readonly kind: "working"; readonly previous: Snapshot };

export function UsagePage({
    session,
    lifetime,
    hidden,
}: {
    readonly session: Session;
    readonly lifetime: AbortSignal;
    readonly hidden: boolean;
}) {
    const [state, setState] = useState<UsageState>({ kind: "loading" });
    const run = useTask(lifetime);
    const chat = useChat(session, lifetime);
    const refresh = useCallback(
        () =>
            run((signal) => session.client.inspectRunner(session.repository, signal), {
                started: () => setState({ kind: "loading" }),
                succeeded: (inspection) => setState({ kind: "ready", inspection }),
                failed: (error) => setState({ kind: "failed", notice: error.message }),
            }),
        [run, session],
    );
    useEffect(() => {
        if (!hidden && !chat.ownsRunner) refresh();
    }, [refresh, hidden, chat.ownsRunner]);
    const act = (action: RunnerAction) => {
        if (state.kind !== "ready" && state.kind !== "stale") return;
        if (action.kind === "check" && (state.kind !== "ready" || state.inspection.runner.kind !== "idle"))
            return;
        const previous = state;
        run(
            async (signal) => {
                switch (action.kind) {
                    case "check":
                        await session.client.checkEnvironment(session.repository, signal);
                        return "检查任务已提交，请刷新状态。检查通过不表示聊天已可用。";
                    case "cancel":
                        await session.client.cancelRunner(session.repository, action.runId, signal);
                        return "停止请求已提交，请刷新状态。尚未确认结束，未保存个人数据。";
                }
            },
            {
                started: () => setState({ kind: "working", previous }),
                succeeded: (notice) => setState({ kind: "stale", inspection: previous.inspection, notice }),
                failed: (error) =>
                    setState({ kind: "stale", inspection: previous.inspection, notice: error.message }),
            },
        );
    };
    const busy = state.kind === "loading" || state.kind === "working";
    const screen = state.kind === "working" ? state.previous : state;
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

import { useCallback, useState } from "react";
import type { RunnerInspection } from "../shared/runner-status.ts";
import type { Session } from "./connection.ts";
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

export function useRunner(session: Session, lifetime: AbortSignal) {
    const [state, setState] = useState<UsageState>({ kind: "loading" });
    const run = useTask(lifetime);
    const refresh = useCallback(
        () =>
            run((signal) => session.client.inspectRunner(session.repository, signal), {
                started: () => setState({ kind: "loading" }),
                succeeded: (inspection) => setState({ kind: "ready", inspection }),
                failed: (error) => setState({ kind: "failed", notice: error.message }),
            }),
        [run, session],
    );
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
    return { screen, busy, refresh, act };
}

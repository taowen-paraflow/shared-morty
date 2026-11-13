import { assertNever, type RunnerState } from "../shared/runner-status.ts";
import type { RunnerAction } from "./use-runner.ts";

const runLabels: Readonly<Record<string, string>> = {
    in_progress: "你的 runner 正在运行。",
    queued: "你的 runner 等待运行。",
    pending: "你的 runner 等待运行。",
    requested: "你的 runner 等待运行。",
    waiting: "你的 runner 等待运行。",
};

interface RunnerPanelProps {
    readonly runner: RunnerState;
    readonly snapshot: "verified" | "stale";
    readonly busy: boolean;
    readonly onAction: (action: RunnerAction) => void;
}

export function RunnerPanel({ runner, snapshot, busy, onAction }: RunnerPanelProps) {
    switch (runner.kind) {
        case "idle":
            return (
                <>
                    <p>当前没有运行中的 runner。</p>
                    {snapshot === "verified" && (
                        <button type="button" disabled={busy} onClick={() => onAction({ kind: "check" })}>
                            检查运行环境
                        </button>
                    )}
                </>
            );
        case "active":
            return (
                <>
                    <p>{runLabels[runner.run.status] ?? "你的 runner 状态待确认，请查看 GitHub。"}</p>
                    <a href={runner.run.url} target="_blank" rel="noopener noreferrer">
                        查看我的 runner
                    </a>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => onAction({ kind: "cancel", runId: runner.run.id })}
                    >
                        强制停止（不保存）
                    </button>
                </>
            );
        case "conflict":
            return (
                <>
                    <p>发现多个尚未结束的任务，请先在 GitHub 确认并处理重复启动。</p>
                    {runner.runs.map((run) => (
                        <div key={run.id}>
                            <a href={run.url} target="_blank" rel="noopener noreferrer">
                                查看我的 runner
                            </a>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => onAction({ kind: "cancel", runId: run.id })}
                            >
                                强制停止任务 {run.id}（不保存）
                            </button>
                        </div>
                    ))}
                </>
            );
        default:
            return assertNever(runner);
    }
}

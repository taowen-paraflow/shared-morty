import { useState } from "react";
import { CHAT_LIFETIME_MS } from "../shared/chat-protocol.ts";
import { assertNever } from "../shared/runner-status.ts";
import { RunnerPanel } from "./runner-panel.tsx";
import type { EnvironmentAction, EnvironmentSnapshot, EnvironmentState } from "./use-environment.ts";

interface Props {
    readonly state: EnvironmentState;
    readonly act: (action: EnvironmentAction) => void;
    readonly retry: () => void;
    readonly repository: string;
    readonly now: number;
}

function currentSnapshot(state: EnvironmentState): EnvironmentSnapshot | null {
    switch (state.kind) {
        case "available":
        case "chat":
            return state;
        case "syncing":
        case "working":
        case "offline":
            return state.previous;
        case "loading":
        case "failed":
            return null;
        default:
            return assertNever(state);
    }
}

export function EnvironmentPanel({ state, act, retry, repository, now }: Props) {
    const [confirmation, setConfirmation] = useState<"closed" | "end">("closed");
    const snapshot = currentSnapshot(state);
    const working = state.kind === "working";
    const chat = snapshot?.kind === "chat" ? snapshot.chat : null;
    const ready = chat?.kind === "ready" && state.kind !== "offline" && !working;
    const starting = chat?.kind === "waiting";
    const stopping =
        chat?.kind === "stopping" || (working && (state.operation === "stop" || state.operation === "force"));
    const startedAt = chat && "context" in chat ? chat.context.request.expiresAt - CHAT_LIFETIME_MS : now;
    const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
    const runUrl =
        chat?.kind === "ready"
            ? `https://github.com/${repository}/actions/runs/${chat.header.runId}`
            : `https://github.com/${repository}/actions/workflows/chat.yml`;
    let title: string;
    let description: string;
    if (state.kind === "loading") {
        title = "正在恢复你的环境";
        description = "正在核验连接与运行状态…";
    } else if (state.kind === "failed" || state.kind === "offline") {
        title = "暂时无法确认环境状态";
        description = state.notice;
    } else if (working && state.operation === "start") {
        title = "正在提交启动请求";
        description = "请稍候，提交后会自动更新进度。";
    } else if (stopping) {
        title = "正在结束环境";
        description = chat?.kind === "stopping" ? chat.notice : "正在提交结束请求…";
    } else if (ready) {
        title = "环境已就绪";
        description = "你的个人 Claude 已连接，可以开始聊天。";
    } else if (starting) {
        title = "正在准备你的 Claude 环境";
        description = chat.notice;
    } else if (snapshot?.kind === "available" && snapshot.inspection.runner.kind !== "idle") {
        title = "你已有一个运行任务";
        description = "请先结束现有任务。运行详情中可以查看并处理它。";
    } else {
        title = "开始你的 Claude 会话";
        description =
            snapshot?.kind === "available" && snapshot.notice
                ? snapshot.notice
                : "使用团队共享账号，创建只属于你的聊天环境。";
    }
    const canStart =
        !working &&
        state.kind !== "offline" &&
        snapshot?.kind === "available" &&
        snapshot.inspection.runner.kind === "idle";
    return (
        <>
            <div className="environment-card">
                <p className="environment-label">团队共享 · 私人会话</p>
                <h3>{title}</h3>
                <p>{description}</p>
                {snapshot?.kind === "available" &&
                    snapshot.inspection.runner.kind !== "idle" &&
                    snapshot.notice && <p>{snapshot.notice}</p>}
                {starting && !stopping && state.kind !== "offline" && (
                    <>
                        <ol className="environment-progress" aria-label="环境准备进度">
                            <li>已提交</li>
                            <li aria-current="step">{chat.stage === "queued" ? "等待运行" : "准备环境"}</li>
                            <li>开始聊天</li>
                        </ol>
                        <p className="environment-note">
                            已等待 {elapsed} 秒 · 首次准备可能需要几分钟，完成后会自动显示聊天入口。
                        </p>
                        {elapsed >= 300 && (
                            <p className="attention">准备时间较长，请查看运行详情，或取消后重试。</p>
                        )}
                        <button
                            className="secondary"
                            type="button"
                            disabled={working}
                            onClick={() => act({ kind: "stop" })}
                        >
                            取消启动
                        </button>
                    </>
                )}
                {ready && (
                    <>
                        <a className="button-link" href={chat.url} target="_blank" rel="noopener noreferrer">
                            打开聊天
                        </a>
                        <p className="environment-note">
                            可以刷新或关闭本页，回来后会自动恢复入口。环境最多运行一小时。
                        </p>
                        {confirmation === "closed" ? (
                            <button
                                className="text-action"
                                type="button"
                                onClick={() => setConfirmation("end")}
                            >
                                结束环境
                            </button>
                        ) : (
                            <fieldset className="end-confirmation">
                                <legend>结束个人环境</legend>
                                <p>结束后，本次环境中的文件和聊天历史不会保存。确定结束吗？</p>
                                <button
                                    className="danger"
                                    type="button"
                                    onClick={() => {
                                        setConfirmation("closed");
                                        act({ kind: "stop" });
                                    }}
                                >
                                    确认结束
                                </button>
                                <button
                                    className="secondary"
                                    type="button"
                                    onClick={() => setConfirmation("closed")}
                                >
                                    继续使用
                                </button>
                            </fieldset>
                        )}
                    </>
                )}
                {canStart && (
                    <>
                        <button type="button" onClick={() => act({ kind: "start" })}>
                            开始聊天
                        </button>
                        <p className="environment-note">每次创建全新环境；结束后不保留本次文件和历史。</p>
                    </>
                )}
                {(state.kind === "offline" || state.kind === "failed") && (
                    <>
                        <p className="environment-note">恢复信息仍保留在本浏览器中，系统会自动重试。</p>
                        <button className="secondary" type="button" onClick={retry}>
                            立即重试
                        </button>
                        {chat && (
                            <button
                                className="text-action"
                                type="button"
                                onClick={() => act({ kind: "stop" })}
                            >
                                重试结束环境
                            </button>
                        )}
                    </>
                )}
            </div>
            <details className="environment-details">
                <summary>运行详情</summary>
                <p>同一 GitHub 用户同时运行一个个人环境。关闭网页不会停止它。</p>
                <a href={runUrl} target="_blank" rel="noopener noreferrer">
                    查看 GitHub 运行记录
                </a>
                {stopping && (
                    <>
                        <p>若长时间没有结束，可强制停止；这可能跳过清理操作。</p>
                        <button
                            className="danger"
                            disabled={working}
                            type="button"
                            onClick={() => act({ kind: "force" })}
                        >
                            强制结束环境
                        </button>
                    </>
                )}
                {snapshot?.kind === "available" && (
                    <>
                        <RunnerPanel
                            runner={snapshot.inspection.runner}
                            snapshot={state.kind === "offline" ? "stale" : "verified"}
                            busy={working || state.kind === "offline"}
                            onAction={act}
                        />
                        <button className="secondary" disabled={working} type="button" onClick={retry}>
                            重新检查
                        </button>
                    </>
                )}
                <p>个人历史保存尚未实现。</p>
            </details>
        </>
    );
}

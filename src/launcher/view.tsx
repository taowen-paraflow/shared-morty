import { useState } from "react";
import { ClaudeSharingPage } from "./claude-sharing-page.tsx";
import { type LauncherOptions, type Session, useConnection } from "./connection.ts";
import { ConnectionForm } from "./connection-form.tsx";
import { UsagePage } from "./usage-page.tsx";

type Page = "use" | "share_claude" | "share_codex";
function Workspace({
    session,
    lifetime,
    options,
}: {
    readonly session: Session;
    readonly lifetime: AbortSignal;
    readonly options: LauncherOptions;
}) {
    const [page, setPage] = useState<Page>("use");
    return (
        <>
            <nav aria-label="功能">
                <button
                    type="button"
                    aria-current={page === "use" ? "page" : undefined}
                    onClick={() => setPage("use")}
                >
                    使用团队账号
                </button>
                <button
                    type="button"
                    aria-current={page === "share_claude" ? "page" : undefined}
                    onClick={() => setPage("share_claude")}
                >
                    共享 Claude Code
                </button>
                <button
                    type="button"
                    aria-current={page === "share_codex" ? "page" : undefined}
                    onClick={() => setPage("share_codex")}
                >
                    共享 Codex
                </button>
            </nav>
            <UsagePage session={session} lifetime={lifetime} hidden={page !== "use"} options={options} />
            <ClaudeSharingPage session={session} lifetime={lifetime} hidden={page !== "share_claude"} />
            {page === "share_codex" && (
                <section role="status" aria-live="polite">
                    <h2>共享我的 Codex 账号</h2>
                    <p>Codex 账号共享尚未实现。</p>
                    <p>此功能用于为团队提供自己的 Codex 账号。使用团队已有账号请前往“使用团队账号”。</p>
                </section>
            )}
        </>
    );
}
export function Launcher({
    options,
    lifetime,
}: {
    readonly options: LauncherOptions;
    readonly lifetime: AbortSignal;
}) {
    const { state, connect } = useConnection(options, lifetime);
    return (
        <>
            <header>
                <p className="eyebrow">SHARED MORTY</p>
                <h1>团队账号，独立对话。</h1>
                <p>使用团队账号，或为团队共享你自己的 Claude Code / Codex 账号。</p>
            </header>
            <details open={state.kind !== "connected"}>
                <summary>
                    {state.kind === "connected"
                        ? `已连接 ${state.session.user.login} · ${state.session.repository}`
                        : "连接 GitHub（首次使用）"}
                </summary>
                <p>
                    {state.kind === "connected"
                        ? "连接与个人环境恢复信息保存在此浏览器；刷新后会重新核验身份并恢复入口。更换账号不会停止现有任务。"
                        : "用你自己的 GitHub 身份启动个人环境，首次连接按下面 3 步完成。"}
                </p>
                <ConnectionForm onConnect={connect} />
            </details>
            {state.kind === "connected" ? (
                <Workspace
                    key={state.session.id}
                    session={state.session}
                    lifetime={lifetime}
                    options={options}
                />
            ) : (
                <section
                    role="status"
                    aria-live="polite"
                    aria-busy={state.kind === "connecting" || state.kind === "restoring"}
                >
                    {state.kind === "restoring"
                        ? "正在恢复 GitHub 连接…"
                        : state.kind === "disconnected"
                          ? "尚未连接 GitHub。"
                          : state.kind === "connecting"
                            ? "正在确认 GitHub 身份与仓库…"
                            : state.error.message}
                </section>
            )}
        </>
    );
}

import { assertNever } from "../shared/runner-status.ts";
import type { useChat } from "./use-chat.ts";

export function ChatPanel({
    chat,
    canStart,
}: {
    readonly chat: ReturnType<typeof useChat>;
    readonly canStart: boolean;
}) {
    const { screen, busy } = chat;
    switch (screen.kind) {
        case "idle":
        case "failed":
        case "stopped":
            return (
                <div>
                    <h3>团队 Claude</h3>
                    {screen.kind !== "idle" && <p>{screen.notice}</p>}
                    <p>
                        使用共享账号启动自己的 Claude 和 Morty。每次为全新环境，停止后不会保存历史。Codex
                        聊天尚未实现。
                    </p>
                    <button type="button" disabled={busy || !canStart} onClick={chat.start}>
                        启动我的 Claude 聊天
                    </button>
                </div>
            );
        case "waiting":
        case "ready":
        case "stopping":
            return (
                <div>
                    <h3>我的 Claude 聊天</h3>
                    <p>{screen.notice}</p>
                    {screen.kind === "ready" && (
                        <>
                            <a href={screen.url} target="_blank" rel="noopener noreferrer">
                                打开我的 Morty 聊天
                            </a>
                            <p>
                                聊天在 Morty
                                网页进行。此入口只交给你自己，不要转发。任务自启动请求起最多运行一小时。
                            </p>
                        </>
                    )}
                    <button type="button" disabled={busy} onClick={chat.refresh}>
                        刷新聊天状态
                    </button>
                    <button type="button" disabled={busy || screen.kind === "stopping"} onClick={chat.stop}>
                        停止我的聊天（不保存）
                    </button>
                    {screen.kind === "stopping" && (
                        <button type="button" disabled={busy} onClick={chat.forceStop}>
                            强制停止 runner（不保存）
                        </button>
                    )}
                    <p>
                        关闭网页不会停止 runner；刷新页面或更换连接会丢失未打开的入口，可在下方停止本人任务。
                    </p>
                </div>
            );
        default:
            return assertNever(screen);
    }
}

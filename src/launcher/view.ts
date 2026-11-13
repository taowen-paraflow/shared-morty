import { assertNever } from "../shared/runner-status.ts";
import type { ConnectionInput, LauncherAction, LauncherState } from "./state.ts";

const runLabels: Readonly<Record<string, string>> = {
    in_progress: "你的 runner 正在运行。",
    queued: "你的 runner 等待运行。",
    pending: "你的 runner 等待运行。",
    requested: "你的 runner 等待运行。",
    waiting: "你的 runner 等待运行。",
};

export function createLauncherView(
    root: HTMLElement,
    onConnect: (input: ConnectionInput) => void,
    onAction: (action: LauncherAction) => void,
) {
    const document = root.ownerDocument;
    root.innerHTML = `
        <header><p class="eyebrow">SHARED MORTY</p><h1>你的环境，你的对话。</h1>
        <p>连接 GitHub，查看属于你的运行环境。</p></header>
        <form>
            <label>执行仓库<input name="repository" placeholder="owner/repository" autocomplete="off" required></label>
            <label>GitHub Token<input name="token" type="password" autocomplete="off" required></label>
            <p class="hint">Token 仅用于本次页面连接。</p>
            <button type="submit">连接 GitHub</button>
        </form>
        <section role="status" aria-live="polite"></section>`;
    const form = root.querySelector("form");
    const repository = root.querySelector<HTMLInputElement>('input[name="repository"]');
    const token = root.querySelector<HTMLInputElement>('input[name="token"]');
    const status = root.querySelector<HTMLElement>('[role="status"]');
    if (!form || !repository || !token || !status) throw new Error("Launcher markup is incomplete");
    const text = (content: string) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = content;
        status.append(paragraph);
    };
    const link = (url: string) => {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.textContent = "查看我的 runner";
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        status.append(anchor);
    };
    const button = (label: string, action: LauncherAction) => {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.addEventListener("click", () => {
            onAction(action);
        });
        status.append(control);
    };
    const render = (state: LauncherState) => {
        status.replaceChildren();
        switch (state.kind) {
            case "disconnected":
                text("尚未连接 GitHub。");
                return;
            case "connecting":
                text("正在确认身份与运行状态…");
                return;
            case "working":
                text("正在处理，请稍候…");
                return;
            case "failed":
                text(state.error.message);
                return;
            case "ready":
            case "needs_refresh": {
                const session = state.session;
                text(`已连接 ${session.inspection.user.login}`);
                if (state.kind === "needs_refresh") text(state.notice);
                button("刷新状态", { kind: "refresh" });
                const runner = session.inspection.runner;
                switch (runner.kind) {
                    case "idle":
                        text("当前没有运行中的 runner。");
                        if (state.kind === "ready") button("检查运行环境", { kind: "check" });
                        return;
                    case "active":
                        text(runLabels[runner.run.status] ?? "你的 runner 状态待确认，请查看 GitHub。");
                        link(runner.run.url);
                        button("强制停止（不保存）", { kind: "cancel", runId: runner.run.id });
                        return;
                    case "conflict":
                        text("发现多个尚未结束的任务，请先在 GitHub 确认并处理重复启动。");
                        for (const run of runner.runs) {
                            link(run.url);
                            button(`强制停止任务 ${run.id}（不保存）`, { kind: "cancel", runId: run.id });
                        }
                        return;
                    default:
                        return assertNever(runner);
                }
            }
            default:
                return assertNever(state);
        }
    };
    const submit = (event: SubmitEvent) => {
        event.preventDefault();
        const input = { repository: repository.value, token: token.value };
        token.value = "";
        onConnect(input);
    };
    form.addEventListener("submit", submit);
    return {
        render,
        dispose: () => {
            form.removeEventListener("submit", submit);
            token.value = "";
            root.replaceChildren();
        },
    };
}

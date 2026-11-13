import { type AppError, publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import { assertNever, type RunnerInspection } from "../shared/runner-status.ts";

type LauncherState =
    | { readonly kind: "disconnected" }
    | { readonly kind: "connecting"; readonly request: AbortController }
    | { readonly kind: "connected"; readonly inspection: RunnerInspection }
    | { readonly kind: "failed"; readonly error: AppError };

interface LauncherOptions {
    readonly apiOrigin?: string;
}

const runLabels: Readonly<Record<string, string>> = {
    in_progress: "你的 runner 正在运行。",
    queued: "你的 runner 等待运行。",
    pending: "你的 runner 等待运行。",
    requested: "你的 runner 等待运行。",
    waiting: "你的 runner 等待运行。",
};

export function mountLauncher(root: HTMLElement, options: LauncherOptions = {}): () => void {
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
    const lifetime = new AbortController();
    let state: LauncherState = { kind: "disconnected" };

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
    const render = () => {
        status.replaceChildren();
        switch (state.kind) {
            case "disconnected":
                text("尚未连接 GitHub。");
                return;
            case "connecting":
                text("正在确认身份与运行状态…");
                return;
            case "failed":
                text(state.error.message);
                return;
            case "connected": {
                text(`已连接 ${state.inspection.user.login}`);
                const runner = state.inspection.runner;
                switch (runner.kind) {
                    case "idle":
                        text("当前没有运行中的 runner。");
                        return;
                    case "active":
                        text(runLabels[runner.run.status] ?? "你的 runner 状态待确认，请查看 GitHub。");
                        link(runner.run.url);
                        return;
                    case "conflict":
                        text("发现多个尚未结束的任务，请先在 GitHub 确认并处理重复启动。");
                        for (const run of runner.runs) link(run.url);
                        return;
                    default:
                        return assertNever(runner);
                }
            }
            default:
                return assertNever(state);
        }
    };
    const transition = (next: LauncherState) => {
        state = next;
        render();
    };
    const connect = async () => {
        if (state.kind === "connecting") state.request.abort();
        const request = new AbortController();
        const secret = token.value;
        const selectedRepository = repository.value;
        token.value = "";
        transition({ kind: "connecting", request });
        const signal = AbortSignal.any([lifetime.signal, request.signal]);
        try {
            const client = new GitHubClient(secret, options.apiOrigin);
            const inspection = await client.inspectRunner(selectedRepository, signal);
            if (!signal.aborted) transition({ kind: "connected", inspection });
        } catch (cause) {
            if (!signal.aborted) transition({ kind: "failed", error: publicError(cause) });
        }
    };
    const submit = (event: SubmitEvent) => {
        event.preventDefault();
        void connect();
    };
    form.addEventListener("submit", submit);
    render();
    return () => {
        lifetime.abort();
        form.removeEventListener("submit", submit);
        token.value = "";
        root.replaceChildren();
    };
}

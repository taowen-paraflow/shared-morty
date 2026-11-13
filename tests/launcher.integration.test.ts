// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, queryByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.ts";
import { githubServer } from "./support/github-server.ts";

function visible(root: HTMLElement, content: string): Promise<void> {
    if (root.textContent?.includes(content)) return Promise.resolve();
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (root.textContent?.includes(content)) {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(root, { childList: true, subtree: true });
    });
}

test("Given Alice has no runner, when she checks the execution environment and cancels it, then only her task starts and finishes", async () => {
    const github = await githubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visible(root, "当前没有运行中的 runner");
        fireEvent.click(getByRole(root, "button", { name: "检查运行环境" }));
        await visible(root, "检查任务已提交");
        expect(queryByRole(root, "button", { name: "检查运行环境" })).toBeNull();
        fireEvent.click(getByRole(root, "button", { name: "刷新状态" }));
        await visible(root, "等待运行");
        expect(queryByRole(root, "button", { name: "检查运行环境" })).toBeNull();
        fireEvent.click(getByRole(root, "button", { name: "强制停止（不保存）" }));
        await visible(root, "停止请求已提交");
        fireEvent.click(getByRole(root, "button", { name: "刷新状态" }));
        await visible(root, "当前没有运行中的 runner");
        expect(root.textContent).not.toContain("fixture-token");
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test("Given an idle snapshot, when refreshing fails authentication, then starting remains blocked until status is verified again", async () => {
    const github = await githubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visible(root, "当前没有运行中的 runner");
        github.rejectAuthentication();
        fireEvent.click(getByRole(root, "button", { name: "刷新状态" }));
        await visible(root, "GitHub Token 无效或已过期。");
        expect(queryByRole(root, "button", { name: "检查运行环境" })).toBeNull();
        expect(getByRole(root, "button", { name: "刷新状态" })).toBeDefined();
        expect(root.textContent).not.toContain("fixture-token");
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test("Given Alice has a pending runner, when she connects GitHub, then the launcher shows her existing environment", async () => {
    const github = await githubServer();
    github.setRuns([{ id: 201, actorId: 42, name: "shared-morty-42-r-own", status: "pending" }]);
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    let observer: MutationObserver | undefined;
    try {
        const connected = new Promise<HTMLElement>((resolve) => {
            observer = new MutationObserver(() => {
                const link = queryByRole(root, "link", { name: "查看我的 runner" });
                if (link) {
                    observer?.disconnect();
                    resolve(link);
                }
            });
            observer.observe(root, { childList: true, subtree: true });
        });
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        const link = await connected;
        expect(link.getAttribute("href")).toBe("https://github.com/team/execution/actions/runs/201");
        expect(root.textContent).toContain("alice");
        expect(root.textContent).toContain("等待运行");
        expect(root.textContent).not.toContain("fixture-token");
        expect(getByLabelText(root, "GitHub Token")).toHaveProperty("value", "");
    } finally {
        observer?.disconnect();
        unmount();
        root.remove();
        await github.close();
    }
});

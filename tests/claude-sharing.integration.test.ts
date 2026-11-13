// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, queryByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { loginGitHubServer } from "./support/login-github.ts";

function visible(root: HTMLElement, content: string): Promise<void> {
    const settled = () =>
        root.textContent?.includes(content) &&
        root.querySelector('[role="status"]')?.getAttribute("aria-busy") !== "true";
    if (settled()) return Promise.resolve();
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (settled()) {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true });
    });
}

test("Given the authorization form has focus, when a malformed code is rejected, then focus stays in the cleared code field", async () => {
    const github = await loginGitHubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visible(root, "当前没有运行中的 runner");
        fireEvent.click(getByRole(root, "button", { name: "登录并共享 Claude" }));
        await visible(root, "等待登录任务");
        await github.publishChallenge();
        fireEvent.click(getByRole(root, "button", { name: "刷新登录状态" }));
        await visible(root, "在官方页面登录");
        const input = getByLabelText<HTMLInputElement>(root, "Claude 授权码");
        input.focus();
        fireEvent.input(input, { target: { value: "contains spaces" } });
        fireEvent.click(getByRole(root, "button", { name: "提交授权码" }));
        await visible(root, "请检查执行仓库、Token 和请求参数。");
        expect(document.activeElement).toBe(getByLabelText(root, "Claude 授权码"));
        expect(getByLabelText(root, "Claude 授权码")).toHaveProperty("value", "");
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test("Given an owner's pending login, when she cancels, then the launcher requests cancellation of that login and returns to her runner state", async () => {
    const github = await loginGitHubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visible(root, "当前没有运行中的 runner");
        fireEvent.click(getByRole(root, "button", { name: "登录并共享 Claude" }));
        await visible(root, "等待登录任务");
        fireEvent.click(getByRole(root, "button", { name: "取消登录" }));
        await visible(root, "已请求停止登录");
        fireEvent.click(getByRole(root, "button", { name: "返回环境" }));
        await visible(root, "当前没有运行中的 runner");
        expect(github.sharedToken()).toBeNull();
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test("Given an owner in a public repository, when she authorizes Claude and shares it, then only encrypted messages and the sealed repository secret leave her page", async () => {
    const github = await loginGitHubServer({ private: false });
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visible(root, "当前没有运行中的 runner");
        fireEvent.click(getByRole(root, "button", { name: "登录并共享 Claude" }));
        await visible(root, "等待登录任务");
        await github.publishChallenge();
        fireEvent.click(getByRole(root, "button", { name: "刷新登录状态" }));
        await visible(root, "在官方页面登录");
        expect(getByRole(root, "link", { name: "打开 Claude 官方授权页面" }).getAttribute("href")).toBe(
            github.authorizationUrl,
        );
        fireEvent.input(getByLabelText(root, "Claude 授权码"), {
            target: { value: github.authorizationCode },
        });
        fireEvent.click(getByRole(root, "button", { name: "提交授权码" }));
        await visible(root, "已发送授权码");
        await github.completeAuthorization();
        fireEvent.click(getByRole(root, "button", { name: "刷新登录状态" }));
        await visible(root, "已登录，尚未共享");
        github.rejectSharing();
        fireEvent.click(getByRole(root, "button", { name: "共享到此仓库" }));
        await visible(root, "没有执行此操作的权限");
        expect(getByRole(root, "button", { name: "共享到此仓库" })).toBeDefined();
        github.allowSharing();
        fireEvent.click(getByRole(root, "button", { name: "共享到此仓库" }));
        await visible(root, "团队 Claude 已共享");
        expect(github.sharedToken()).toBe(github.token);
        expect(github.messages()).not.toContain(github.authorizationCode);
        expect(github.messages()).not.toContain(github.authorizationUrl);
        expect(github.messages()).not.toContain(github.token);
        expect(root.textContent).not.toContain(github.token);
        expect(root.textContent).not.toContain(github.authorizationCode);
        expect(queryByRole(root, "button", { name: "共享到此仓库" })).toBeNull();
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

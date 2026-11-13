// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, queryByRole } from "@testing-library/dom";
import { expect, test, vi } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { githubServer } from "./support/github-server.ts";
import { launcherClock } from "./support/launcher-clock.ts";
import { visibleStatus } from "./support/launcher-ui.ts";
import { loginGitHubServer } from "./support/login-github.ts";

test("Given a connected member, when she opens her environment, then one lifecycle panel replaces separate chat and runner controls", async () => {
    const github = await githubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "当前没有运行中的 runner");
        expect(getByRole(root, "button", { name: "开始聊天" })).toBeDefined();
        expect(queryByRole(root, "button", { name: "刷新聊天状态" })).toBeNull();
        expect(queryByRole(root, "button", { name: "刷新状态" })).toBeNull();
        expect(getByRole(root, "heading", { name: "个人 Claude 环境" })).toBeDefined();
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test.each(["failure", "cancelled"])(
    "Given a saved starting environment, when the page reloads and Actions finishes with %s without a bot message, then polling releases the environment",
    async (conclusion) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
        const github = await loginGitHubServer({ workflow: "chat" });
        const clock = launcherClock();
        const root = document.createElement("main");
        document.body.append(root);
        let unmount = mountLauncher(root, { apiOrigin: github.origin, clock });
        try {
            fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
            fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
            fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
            await visibleStatus(root, "开始你的 Claude 会话");
            fireEvent.click(getByRole(root, "button", { name: "开始聊天" }));
            await visibleStatus(root, "正在准备你的 Claude 环境");
            unmount();
            unmount = mountLauncher(root, { apiOrigin: github.origin, clock });
            await visibleStatus(root, "正在准备你的 Claude 环境");
            expect(getByRole(root, "button", { name: "取消启动" })).toBeDefined();
            github.finishRun(conclusion);
            await clock.tick(5_000);
            await visibleStatus(root, conclusion === "failure" ? "环境准备未完成" : "个人环境已结束");
            expect(getByRole(root, "button", { name: "开始聊天" })).toBeDefined();
            unmount();
            unmount = mountLauncher(root, { apiOrigin: github.origin, clock });
            await visibleStatus(root, "开始你的 Claude 会话");
            expect(queryByRole(root, "button", { name: "取消启动" })).toBeNull();
        } finally {
            unmount();
            root.remove();
            await github.close();
            vi.useRealTimers();
        }
    },
);

test("Given an encrypted browser connection, when its credential expires or resolves to another user after reload, then the saved environment is not exposed", async () => {
    const github = await loginGitHubServer({ workflow: "chat" });
    const root = document.createElement("main");
    document.body.append(root);
    let unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "开始你的 Claude 会话");
        fireEvent.click(getByRole(root, "button", { name: "开始聊天" }));
        await visibleStatus(root, "正在准备你的 Claude 环境");
        github.allowAuthentication(false);
        unmount();
        unmount = mountLauncher(root, { apiOrigin: github.origin });
        await visibleStatus(root, "GitHub Token 无效或已过期");
        expect(queryByRole(root, "button", { name: "取消启动" })).toBeNull();
        github.allowAuthentication(true);
        github.authenticateAs(99);
        unmount();
        unmount = mountLauncher(root, { apiOrigin: github.origin });
        await visibleStatus(root, "GitHub Token 无效或已过期");
        expect(queryByRole(root, "button", { name: "取消启动" })).toBeNull();
        github.authenticateAs(42);
        unmount();
        unmount = mountLauncher(root, { apiOrigin: github.origin });
        await visibleStatus(root, "正在准备你的 Claude 环境");
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

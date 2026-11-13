// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, queryByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { githubServer } from "./support/github-server.ts";
import { launcherClock } from "./support/launcher-clock.ts";
import { visibleStatus } from "./support/launcher-ui.ts";
import { loginGitHubServer } from "./support/login-github.ts";

test("Given a team member, when she chooses each feature, then usage, Claude sharing, and Codex sharing have separate controls", async () => {
    const github = await loginGitHubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const clock = launcherClock();
    const unmount = mountLauncher(root, { apiOrigin: github.origin, clock });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "当前没有运行中的 runner");
        expect(getByRole(root, "heading", { name: "个人 Claude 环境" })).toBeDefined();
        expect(queryByRole(root, "button", { name: "开始 Claude 授权" })).toBeNull();
        fireEvent.click(getByRole(root, "button", { name: "共享 Codex" }));
        await visibleStatus(root, "Codex 账号共享尚未实现");
        expect(queryByRole(root, "button", { name: "检查运行环境" })).toBeNull();
        expect(queryByRole(root, "button", { name: "开始 Claude 授权" })).toBeNull();
        fireEvent.click(getByRole(root, "button", { name: "共享 Claude Code" }));
        await visibleStatus(root, "为团队提供你自己的 Claude Code 账号");
        expect(getByRole(root, "button", { name: "开始 Claude 授权" })).toBeDefined();
        expect(queryByRole(root, "button", { name: "检查运行环境" })).toBeNull();
        expect(github.sharedToken()).toBeNull();
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test("Given a pending Claude authorization, when the owner visits usage and returns, then her private exchange survives without mixing controls", async () => {
    const github = await loginGitHubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const clock = launcherClock();
    const unmount = mountLauncher(root, { apiOrigin: github.origin, clock });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "当前没有运行中的 runner");
        fireEvent.click(getByRole(root, "button", { name: "共享 Claude Code" }));
        await visibleStatus(root, "为团队提供你自己的 Claude Code 账号");
        fireEvent.click(getByRole(root, "button", { name: "开始 Claude 授权" }));
        await visibleStatus(root, "等待登录任务");
        await github.publishChallenge();
        fireEvent.click(getByRole(root, "button", { name: "刷新登录状态" }));
        await visibleStatus(root, "在官方页面登录");
        fireEvent.click(getByRole(root, "button", { name: "使用团队账号" }));
        await clock.tick(30_000);
        await visibleStatus(root, "正在运行");
        expect(queryByRole(root, "button", { name: "提交授权码" })).toBeNull();
        expect(queryByRole(root, "link", { name: "打开 Claude 官方授权页面" })).toBeNull();
        fireEvent.click(getByRole(root, "button", { name: "共享 Claude Code" }));
        await visibleStatus(root, "在官方页面登录");
        fireEvent.input(getByLabelText(root, "Claude 授权码"), {
            target: { value: github.authorizationCode },
        });
        fireEvent.click(getByRole(root, "button", { name: "提交授权码" }));
        await visibleStatus(root, "已发送授权码");
        await github.completeAuthorization();
        fireEvent.click(getByRole(root, "button", { name: "刷新登录状态" }));
        await visibleStatus(root, "已登录，尚未共享");
        fireEvent.click(getByRole(root, "button", { name: "共享到此仓库" }));
        await visibleStatus(root, "团队 Claude 已共享");
        expect(github.sharedToken()).toBe(github.token);
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

test("Given a running environment check, when the owner starts Claude sharing from another page, then a second runner is refused", async () => {
    const github = await githubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const clock = launcherClock();
    const unmount = mountLauncher(root, { apiOrigin: github.origin, clock });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "当前没有运行中的 runner");
        fireEvent.click(getByRole(root, "button", { name: "检查运行环境" }));
        await visibleStatus(root, "检查任务已提交");
        fireEvent.click(getByRole(root, "button", { name: "共享 Claude Code" }));
        await visibleStatus(root, "为团队提供你自己的 Claude Code 账号");
        fireEvent.click(getByRole(root, "button", { name: "开始 Claude 授权" }));
        await visibleStatus(root, "你已有尚未结束的 runner");
        expect(queryByRole(root, "button", { name: "提交授权码" })).toBeNull();
        fireEvent.click(getByRole(root, "button", { name: "使用团队账号" }));
        await visibleStatus(root, "等待运行");
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

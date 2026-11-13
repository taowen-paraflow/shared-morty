// @vitest-environment happy-dom

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fireEvent, getByLabelText, getByRole, queryByRole } from "@testing-library/dom";
import * as v from "valibot";
import { expect, test, vi } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { runPersonalChat } from "../src/runner/personal-chat.ts";
import { chatRequestSchema } from "../src/shared/chat-protocol.ts";
import type { Diagnostic } from "../src/shared/diagnostics.ts";
import { AppError } from "../src/shared/errors.ts";
import { GitHubClient } from "../src/shared/github.ts";
import { parseJson } from "../src/shared/login-protocol.ts";
import { visibleStatus } from "./support/launcher-ui.ts";
import { loginGitHubServer } from "./support/login-github.ts";

test.each(["ready", "agent_failure", "morty_failure", "unsafe_link"])(
    "Given a team member using a public repository, when her personal agent reports %s, then the launcher exposes only the verified private chat outcome",
    async (outcome) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
        const github = await loginGitHubServer({ private: false, workflow: "chat" });
        const lifetime = new AbortController();
        const root = document.createElement("main");
        document.body.append(root);
        const unmount = mountLauncher(root, { apiOrigin: github.origin });
        const previousSecret = process.env.UNRELATED_SECRET;
        process.env.UNRELATED_SECRET = "must-not-reach-personal-agent";
        const diagnostics: Diagnostic[] = [];
        let finished: Promise<unknown> | undefined;
        let tick: (() => void) | undefined;
        let notifyWaiting: (() => void) | undefined;
        const waiting = new Promise<void>((resolve) => {
            notifyWaiting = resolve;
        });
        try {
            fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
            fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
            fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
            await visibleStatus(root, "当前没有运行中的 runner");
            fireEvent.click(getByRole(root, "button", { name: "启动我的 Claude 聊天" }));
            await visibleStatus(root, "个人 Claude 正在启动");
            const response = await fetch(`${github.origin}/repos/team/execution/issues/601`, {
                headers: { authorization: "Bearer fixture-token" },
            });
            const issue = v.parse(v.object({ body: v.string() }), await response.json());
            const request = v.parse(chatRequestSchema, parseJson(issue.body));
            const fixture = resolve("tests/fixtures/fake-personal-agent.mjs");
            const worker = runPersonalChat(
                new GitHubClient("runner-token", github.origin),
                {
                    repository: "team/execution",
                    runId: "701",
                    userId: "42",
                    ref: "refs/heads/main",
                    requestId: request.requestId,
                    attempt: 1,
                    issue: 601,
                },
                github.token,
                lifetime.signal,
                {
                    programs: {
                        claude: { command: process.execPath, args: [fixture, "claude", outcome] },
                        morty: { command: process.execPath, args: [fixture, "morty", outcome] },
                    },
                    clock: {
                        now: Date.now,
                        wait: (_milliseconds, signal) =>
                            new Promise<void>((resolve, reject) => {
                                const abort = () => reject(new AppError("cancelled"));
                                tick = () => {
                                    signal.removeEventListener("abort", abort);
                                    resolve();
                                };
                                signal.addEventListener("abort", abort, { once: true });
                                notifyWaiting?.();
                            }),
                    },
                    diagnostic: (record) => diagnostics.push(record),
                },
            );
            finished =
                outcome === "ready"
                    ? expect(worker).resolves.toBeUndefined()
                    : expect(worker).rejects.toMatchObject({
                          code:
                              outcome === "agent_failure"
                                  ? "agent_failed"
                                  : outcome === "morty_failure"
                                    ? "morty_unavailable"
                                    : "invalid_response",
                      });
            if (outcome === "ready") {
                await github.waitForMessage("ready");
                await waiting;
                fireEvent.click(getByRole(root, "button", { name: "刷新聊天状态" }));
                await visibleStatus(root, "个人 Claude 聊天已就绪");
                const link = getByRole(root, "link", { name: "打开我的 Morty 聊天" }).getAttribute("href");
                if (!link) throw new Error("Missing private handoff");
                const workspace = new URL(link).searchParams.get("workspace");
                expect(link).toContain("https://morty.build/continue");
                expect(github.messages()).not.toContain("synthetic-private-morty-transfer");
                fireEvent.click(getByRole(root, "button", { name: "共享 Codex" }));
                await visibleStatus(root, "Codex 账号共享尚未实现");
                expect(queryByRole(root, "link", { name: "打开我的 Morty 聊天" })).toBeNull();
                fireEvent.click(getByRole(root, "button", { name: "使用团队账号" }));
                await visibleStatus(root, "个人 Claude 聊天已就绪");
                expect(getByRole(root, "link", { name: "打开我的 Morty 聊天" }).getAttribute("href")).toBe(
                    link,
                );
                fireEvent.click(getByRole(root, "button", { name: "停止我的聊天（不保存）" }));
                await visibleStatus(root, "停止请求已提交");
                expect(queryByRole(root, "link", { name: "打开我的 Morty 聊天" })).toBeNull();
                tick?.();
                await finished;
                github.finishRun();
                if (!workspace) throw new Error("Missing workspace");
                await expect(stat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
                fireEvent.click(getByRole(root, "button", { name: "刷新聊天状态" }));
                await visibleStatus(root, "个人聊天已停止");
            } else {
                await finished;
                github.finishRun();
                fireEvent.click(getByRole(root, "button", { name: "刷新聊天状态" }));
                await visibleStatus(
                    root,
                    outcome === "agent_failure"
                        ? "Claude 未能启动"
                        : outcome === "morty_failure"
                          ? "Morty 暂时无法连接"
                          : "GitHub 返回了无法验证的数据",
                );
                expect(queryByRole(root, "link", { name: "打开我的 Morty 聊天" })).toBeNull();
            }
            expect(github.messages()).not.toContain(github.token);
            expect(JSON.stringify(diagnostics)).not.toContain(github.token);
            expect(JSON.stringify(diagnostics)).not.toContain("synthetic-private-morty-transfer");
        } finally {
            lifetime.abort();
            await finished;
            unmount();
            root.remove();
            await github.close();
            if (previousSecret === undefined) delete process.env.UNRELATED_SECRET;
            else process.env.UNRELATED_SECRET = previousSecret;
            vi.useRealTimers();
        }
    },
);

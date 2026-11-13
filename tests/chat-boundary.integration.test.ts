import { expect, test, vi } from "vitest";
import { beginPersonalChat, refreshPersonalChat } from "../src/launcher/personal-chat.ts";
import { type ChatHeader, chatContext } from "../src/shared/chat-protocol.ts";
import { GitHubClient } from "../src/shared/github.ts";
import { createLoginKey, seal } from "../src/shared/login-crypto.ts";
import { loginGitHubServer } from "./support/login-github.ts";

test.each(["wrong_author", "wrong_attempt", "wrong_issue", "wrong_key"])(
    "Given a private chat startup, when a ready message has %s, then it cannot grant a Morty link",
    async (fault) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
        const github = await loginGitHubServer({ workflow: "chat" });
        const signal = new AbortController().signal;
        try {
            const browser = new GitHubClient("fixture-token", github.origin);
            const state = await beginPersonalChat(browser, "team/execution", signal);
            if (state.kind !== "waiting") throw new Error("Missing launch context");
            await expect(beginPersonalChat(browser, "team/execution", signal)).rejects.toMatchObject({
                code: "runner_busy",
            });
            const header: ChatHeader = {
                version: 1,
                purpose: "claude_chat",
                kind: "ready",
                requestId: state.context.request.requestId,
                runId: "701",
                attempt: fault === "wrong_attempt" ? 2 : 1,
                expiresAt: state.context.request.expiresAt,
            };
            const other = await createLoginKey();
            const payload = await seal(
                fault === "wrong_key" ? other.publicKey : state.context.key.publicKey,
                {
                    url: "https://morty.build/continue?harness=claude&sessionId=123e4567-e89b-42d3-a456-426614174000#code=fixture",
                    accessExpiresAt: "2026-11-13T01:00:00.000Z",
                },
                chatContext("team/execution", fault === "wrong_issue" ? 602 : 601, header),
            );
            const sender = new GitHubClient(
                fault === "wrong_author" ? "fixture-token" : "runner-token",
                github.origin,
            );
            await sender.chatChannel("team/execution").send(601, { ...header, payload }, signal);
            if (fault === "wrong_author")
                expect(await refreshPersonalChat(browser, state, signal)).toMatchObject({ kind: "waiting" });
            else
                await expect(refreshPersonalChat(browser, state, signal)).rejects.toMatchObject({
                    code: fault === "wrong_attempt" ? "unsafe_execution" : "invalid_response",
                });
            vi.setSystemTime(new Date("2026-11-13T01:00:01Z"));
            expect(await refreshPersonalChat(browser, state, signal)).toMatchObject({ kind: "stopped" });
        } finally {
            await github.close();
            vi.useRealTimers();
        }
    },
);

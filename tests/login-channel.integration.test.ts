import { expect, test, vi } from "vitest";
import { beginClaudeLogin, refreshClaudeLogin } from "../src/launcher/claude-login.ts";
import { GitHubClient } from "../src/shared/github.ts";
import { LOGIN_LIFETIME_MS } from "../src/shared/login-protocol.ts";
import { loginGitHubServer } from "./support/login-github.ts";

test("Given a public execution repository, when the owner begins a login, then no authorization channel is created", async () => {
    const github = await loginGitHubServer({ private: false });
    try {
        await expect(
            beginClaudeLogin(
                new GitHubClient("fixture-token", github.origin),
                "team/execution",
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({ code: "unsafe_execution" });
        expect(github.messages()).toBe(JSON.stringify({ requestBody: "", comments: [] }));
    } finally {
        await github.close();
    }
});

test.each([
    { name: "a different run attempt", options: { attempt: 2 }, code: "unsafe_execution" },
    { name: "ciphertext bound to another issue", options: { contextIssue: 602 }, code: "invalid_response" },
    {
        name: "an untrusted authorization host",
        options: { url: "https://attacker.example/oauth/authorize" },
        code: "invalid_response",
    },
])(
    "Given $name, when the launcher reads the login challenge, then it refuses the message",
    async ({ options, code }) => {
        const github = await loginGitHubServer();
        const client = new GitHubClient("fixture-token", github.origin);
        const signal = new AbortController().signal;
        try {
            const state = await beginClaudeLogin(client, "team/execution", signal);
            await github.publishChallenge(options);
            await expect(refreshClaudeLogin(client, state, signal)).rejects.toMatchObject({ code });
        } finally {
            await github.close();
        }
    },
);

test("Given another repository member posts a challenge, when the launcher reads it, then it keeps waiting for the verified runner", async () => {
    const github = await loginGitHubServer();
    const client = new GitHubClient("fixture-token", github.origin);
    const signal = new AbortController().signal;
    try {
        const state = await beginClaudeLogin(client, "team/execution", signal);
        await github.publishChallenge({ authorId: 99 });
        expect(await refreshClaudeLogin(client, state, signal)).toMatchObject({ kind: "waiting" });
        await github.publishChallenge();
        expect(await refreshClaudeLogin(client, state, signal)).toMatchObject({ kind: "authorizing" });
    } finally {
        await github.close();
    }
});

test("Given an expired login, when the owner refreshes, then it fails without showing the old authorization link", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
    const github = await loginGitHubServer();
    const client = new GitHubClient("fixture-token", github.origin);
    const signal = new AbortController().signal;
    try {
        const state = await beginClaudeLogin(client, "team/execution", signal);
        await github.publishChallenge();
        vi.setSystemTime(new Date(Date.now() + LOGIN_LIFETIME_MS));
        expect(await refreshClaudeLogin(client, state, signal)).toMatchObject({
            kind: "failed",
            notice: expect.stringContaining("超时"),
        });
    } finally {
        await github.close();
        vi.useRealTimers();
    }
});

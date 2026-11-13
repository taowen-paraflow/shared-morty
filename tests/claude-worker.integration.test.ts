import { fileURLToPath } from "node:url";
import { expect, test, vi } from "vitest";
import { beginClaudeLogin, refreshClaudeLogin, sendClaudeCode } from "../src/launcher/claude-login.ts";
import { runClaudeLogin } from "../src/runner/claude-login.ts";
import type { Diagnostic } from "../src/shared/diagnostics.ts";
import { GitHubClient } from "../src/shared/github.ts";
import { loginGitHubServer } from "./support/login-github.ts";

test.each(["authorized", "invalid_code", "replayed_code", "cancelled"])(
    "Given an owner's login request, when the isolated Claude subprocess ends with %s, then it publishes only the correct encrypted outcome",
    async (outcome) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
        const github = await loginGitHubServer();
        const previousSecret = process.env.UNRELATED_SECRET;
        process.env.UNRELATED_SECRET = "synthetic-secret-must-not-reach-provider";
        const lifetime = new AbortController();
        let now = Date.now();
        const diagnostics: Diagnostic[] = [];
        let tick: (() => void) | undefined;
        let notifyWaiting: (() => void) | undefined;
        const waiting = new Promise<void>((resolve) => {
            notifyWaiting = resolve;
        });
        try {
            const browser = new GitHubClient("fixture-token", github.origin);
            const state = await beginClaudeLogin(browser, "team/execution", lifetime.signal);
            if (state.kind !== "waiting") throw new Error("Expected waiting login");
            const worker = runClaudeLogin(
                new GitHubClient("runner-token", github.origin),
                {
                    repository: "team/execution",
                    runId: "701",
                    userId: "42",
                    ref: "refs/heads/main",
                    requestId: state.context.request.requestId,
                    attempt: 1,
                    issue: state.context.issue,
                },
                lifetime.signal,
                {
                    diagnostic: (record) => {
                        diagnostics.push(record);
                    },
                    clock: {
                        now: () => now,
                        wait: (_milliseconds, signal) =>
                            new Promise<void>((resolve, reject) => {
                                const abort = () => reject(new Error("Cancelled fixture clock"));
                                tick = () => {
                                    signal.removeEventListener("abort", abort);
                                    now += 3000;
                                    resolve();
                                };
                                signal.addEventListener("abort", abort, { once: true });
                                notifyWaiting?.();
                            }),
                    },
                    program: {
                        command: process.execPath,
                        args: [fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url))],
                        transport: process.platform === "linux" ? "pty" : "pipe",
                    },
                },
            );
            const expectedCode =
                outcome === "invalid_code"
                    ? "provider_failed"
                    : outcome === "replayed_code"
                      ? "invalid_response"
                      : "cancelled";
            const finished =
                outcome === "authorized"
                    ? expect(worker).resolves.toBeUndefined()
                    : expect(worker).rejects.toMatchObject({ code: expectedCode });
            await waiting;
            const challenge = await refreshClaudeLogin(browser, state, lifetime.signal);
            if (challenge.kind !== "authorizing") throw new Error("Missing challenge");
            const submitted =
                outcome === "cancelled"
                    ? challenge
                    : await sendClaudeCode(
                          challenge,
                          outcome === "invalid_code"
                              ? "invalid-code#fixture-state"
                              : github.authorizationCode,
                          lifetime.signal,
                      );
            if (outcome === "replayed_code")
                await sendClaudeCode(challenge, github.authorizationCode, lifetime.signal);
            if (outcome === "cancelled") lifetime.abort();
            tick?.();
            await finished;
            const result = await refreshClaudeLogin(browser, submitted, new AbortController().signal);
            expect(result).toMatchObject(
                outcome === "authorized" ? { kind: "authorized", token: github.token } : { kind: "failed" },
            );
            expect(github.messages()).not.toContain(github.token);
            expect(github.messages()).not.toContain(github.authorizationCode);
            expect(github.messages()).not.toContain(github.authorizationUrl);
            const log = JSON.stringify(diagnostics);
            expect(log).toContain('"event":"terminal.output"');
            expect(log).toContain('"event":"terminal.exit"');
            if (outcome === "authorized" || outcome === "invalid_code")
                expect(log).toContain('"mode":"masked"');
            expect(log).not.toContain(github.token);
            expect(log).not.toContain(github.authorizationCode);
            expect(log).not.toContain(github.authorizationUrl);
            expect(log).not.toContain("fixture-sensitive-state");
            expect(log).not.toContain("synthetic-secret-must-not-reach-provider");
        } finally {
            if (previousSecret === undefined) delete process.env.UNRELATED_SECRET;
            else process.env.UNRELATED_SECRET = previousSecret;
            lifetime.abort();
            tick?.();
            await github.close();
            vi.useRealTimers();
        }
    },
);

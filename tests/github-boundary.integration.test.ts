import { expect, test, vi } from "vitest";
import { GitHubClient } from "../src/shared/github.ts";
import { githubServer } from "./support/github-server.ts";

test("Given a runner on a later page, when GitHub is inspected, then pending work is not mistaken for idle", async () => {
    const github = await githubServer();
    github.setRuns([
        ...Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            actorId: 42,
            name: `shared-morty-42-r-${index}`,
            status: "completed",
        })),
        { id: 101, actorId: 42, name: "shared-morty-42-r-later", status: "waiting" },
    ]);
    try {
        const result = await new GitHubClient("fixture-token", github.origin).inspectRunner(
            "team/execution",
            new AbortController().signal,
        );
        expect(result.runner).toEqual({
            kind: "active",
            run: { id: 101, status: "waiting", url: "https://github.com/team/execution/actions/runs/101" },
        });
    } finally {
        await github.close();
    }
});

test("Given two unfinished personal runs, when inspected, then the conflict is visible", async () => {
    const github = await githubServer();
    github.setRuns([
        { id: 1, actorId: 42, name: "shared-morty-42-r-one", status: "in_progress" },
        { id: 2, actorId: 42, name: "shared-morty-42-r-two", status: "pending" },
    ]);
    try {
        const result = await new GitHubClient("fixture-token", github.origin).inspectRunner(
            "team/execution",
            new AbortController().signal,
        );
        expect(result.runner.kind).toBe("conflict");
    } finally {
        await github.close();
    }
});

test("Given no unfinished personal runs, when inspected, then the environment is idle", async () => {
    const github = await githubServer();
    try {
        const result = await new GitHubClient("fixture-token", github.origin).inspectRunner(
            "team/execution",
            new AbortController().signal,
        );
        expect(result.runner).toEqual({ kind: "idle" });
    } finally {
        await github.close();
    }
});

test("Given rejected authentication, when connecting, then only a sanitized typed error crosses the boundary", async () => {
    const github = await githubServer();
    github.rejectAuthentication();
    try {
        const pending = new GitHubClient("fixture-token", github.origin).inspectRunner(
            "team/execution",
            new AbortController().signal,
        );
        await expect(pending).rejects.toMatchObject({
            code: "unauthenticated",
            message: "GitHub Token 无效或已过期。",
        });
    } finally {
        await github.close();
    }
});

test("Given malformed GitHub data, when inspecting, then the result is an error rather than an idle environment", async () => {
    const github = await githubServer();
    github.invalidateRuns();
    try {
        await expect(
            new GitHubClient("fixture-token", github.origin).inspectRunner(
                "team/execution",
                new AbortController().signal,
            ),
        ).rejects.toMatchObject({ code: "invalid_response" });
    } finally {
        await github.close();
    }
});

test("Given an in-flight GitHub request, when the caller cancels, then cancellation is preserved", async () => {
    const github = await githubServer();
    const received = github.pauseRuns();
    const controller = new AbortController();
    try {
        const pending = new GitHubClient("fixture-token", github.origin).inspectRunner(
            "team/execution",
            controller.signal,
        );
        const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
        await received;
        controller.abort();
        await rejected;
    } finally {
        controller.abort();
        await github.close();
    }
});

test("Given an unresponsive GitHub request, when its deadline passes, then it terminates with a timeout", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
    const github = await githubServer();
    const received = github.pauseRuns();
    const controller = new AbortController();
    try {
        const pending = new GitHubClient("fixture-token", github.origin).inspectRunner(
            "team/execution",
            controller.signal,
        );
        const rejected = expect(pending).rejects.toMatchObject({ code: "timeout" });
        await received;
        await vi.advanceTimersByTimeAsync(15_000);
        await rejected;
    } finally {
        controller.abort();
        await github.close();
        vi.useRealTimers();
    }
});

test("Given a cancelled operation, when inspection starts, then no successful state is returned", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
        new GitHubClient("fixture-token").inspectRunner("team/execution", controller.signal),
    ).rejects.toMatchObject({ code: "cancelled" });
});

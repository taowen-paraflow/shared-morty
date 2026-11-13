import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { githubServer } from "./support/github-server.ts";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../src/runner/main.ts", import.meta.url));

test("Given a credential-stealing API origin, when the CLI inspects status, then it rejects the target", async () => {
    await expect(
        execute(
            process.execPath,
            [entry, "status", "--repository", "team/execution", "--api-origin", "https://attacker.example"],
            {
                env: { ...process.env, GH_TOKEN: "fixture-token" },
                timeout: 10_000,
            },
        ),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('"code":"invalid_input"') });
});

test("Given authenticated Alice and mixed runs, when she inspects status, then only her runner is shown", async () => {
    const github = await githubServer();
    github.setRuns([
        { id: 101, actorId: 42, name: "shared-morty-42-r-own", status: "in_progress" },
        { id: 102, actorId: 99, name: "shared-morty-99-r-other", status: "in_progress" },
        { id: 103, actorId: 99, name: "shared-morty-42-r-forged", status: "in_progress" },
        {
            id: 104,
            actorId: 42,
            name: "shared-morty-42-r-experiment",
            status: "in_progress",
            path: ".github/workflows/unrelated.yml",
        },
    ]);
    try {
        const result = await execute(
            process.execPath,
            [entry, "status", "--repository", "team/execution", "--api-origin", github.origin],
            {
                env: { ...process.env, GH_TOKEN: "fixture-token" },
                timeout: 10_000,
            },
        );
        expect(JSON.parse(result.stdout)).toEqual({
            user: { id: "42", login: "alice" },
            runner: {
                kind: "active",
                run: {
                    id: 101,
                    status: "in_progress",
                    url: "https://github.com/team/execution/actions/runs/101",
                },
            },
        });
        expect(result.stdout + result.stderr).not.toContain("fixture-token");
    } finally {
        await github.close();
    }
});

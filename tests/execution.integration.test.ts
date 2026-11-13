import { execFile } from "node:child_process";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { githubServer } from "./support/github-server.ts";

const execute = promisify(execFile);
const entry = fileURLToPath(new URL("../src/runner/check.ts", import.meta.url));
const requestId = "bb46c601-ae8e-4882-bbb8-020051ecde1a";

test.each([
    { privateRepository: true, actor: "42", ref: "refs/heads/main", accepted: true },
    { privateRepository: false, actor: "42", ref: "refs/heads/main", accepted: true },
    { privateRepository: true, actor: "99", ref: "refs/heads/main", accepted: false },
    { privateRepository: true, actor: "42", ref: "refs/heads/untrusted", accepted: false },
])(
    "Given execution context $privateRepository/$actor/$ref, when the worker verifies it, then acceptance is $accepted",
    async ({ privateRepository, actor, ref, accepted }) => {
        const github = await githubServer();
        github.setPrivate(privateRepository);
        const directory = await mkdtemp(join(tmpdir(), "shared-morty-check-"));
        const eventPath = join(directory, "event.json");
        await writeFile(eventPath, JSON.stringify({ inputs: { mode: "check", request_id: requestId } }));
        try {
            const operation = execute(process.execPath, [entry, "--api-origin", github.origin], {
                env: {
                    ...process.env,
                    GH_TOKEN: "fixture-token",
                    GITHUB_EVENT_PATH: eventPath,
                    GITHUB_EVENT_NAME: "workflow_dispatch",
                    GITHUB_REPOSITORY: "team/execution",
                    GITHUB_ACTOR_ID: actor,
                    GITHUB_RUN_ID: "501",
                    GITHUB_REF: ref,
                    SHARED_CLAUDE_AVAILABLE: "true",
                    SHARED_MORTY_DIAGNOSTICS: "1",
                },
                timeout: 10_000,
            });
            if (accepted) {
                const result = await operation;
                expect(JSON.parse(result.stdout)).toEqual({
                    kind: "checked",
                    userId: "42",
                    requestId,
                    claude: "configured",
                    chat: "not_implemented",
                });
                expect(result.stdout + result.stderr).not.toContain("fixture-token");
                expect(result.stderr).toContain('"event":"github.response"');
            } else {
                await expect(operation).rejects.toMatchObject({
                    stderr: expect.stringContaining('"code":"unsafe_execution"'),
                });
            }
        } finally {
            await github.close();
            await rm(eventPath);
            await rmdir(directory);
        }
    },
);

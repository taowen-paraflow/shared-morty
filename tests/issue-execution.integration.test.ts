import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);
const requestId = "bb46c601-ae8e-4882-bbb8-020051ecde1a";
const invalidContexts = [
    { event: "pull_request", args: [], issue: "1", code: "unsafe_execution" },
    { event: "workflow_dispatch", args: ["--unexpected"], issue: "1", code: "unsafe_execution" },
    { event: "workflow_dispatch", args: [], issue: "9007199254740992", code: "invalid_input" },
];

test.each(["login", "chat"])(
    "Given invalid Actions context, when the public %s CLI starts, then it rejects execution before obtaining provider credentials",
    async (entry) => {
        const directory = await mkdtemp(join(tmpdir(), "shared-morty-invalid-context-"));
        const eventPath = join(directory, "event.json");
        try {
            for (const context of invalidContexts) {
                await writeFile(
                    eventPath,
                    JSON.stringify({ inputs: { request_id: requestId, issue: context.issue } }),
                );
                await expect(
                    execute(process.execPath, [resolve(`src/runner/${entry}.ts`), ...context.args], {
                        env: {
                            PATH: process.env.PATH,
                            GITHUB_EVENT_NAME: context.event,
                            GITHUB_EVENT_PATH: eventPath,
                            GITHUB_RUN_ATTEMPT: "1",
                        },
                        timeout: 10_000,
                    }),
                ).rejects.toMatchObject({ stderr: expect.stringContaining(`"code":"${context.code}"`) });
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
);

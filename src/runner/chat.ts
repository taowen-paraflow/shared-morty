import { readFile, stat } from "node:fs/promises";
import * as v from "valibot";
import { AppError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import { parseJson } from "../shared/login-protocol.ts";
import { runCommand } from "./command.ts";
import { runPersonalChat } from "./personal-chat.ts";

await runCommand(async (signal) => {
    if (process.argv.length !== 2 || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch")
        throw new AppError("unsafe_execution");
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || (await stat(eventPath)).size > 1_000_000) throw new AppError("invalid_input");
    const event = v.safeParse(
        v.object({
            inputs: v.object({
                request_id: v.pipe(v.string(), v.uuid()),
                issue: v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/u)),
            }),
        }),
        parseJson(await readFile(eventPath, { encoding: "utf8", signal })),
    );
    const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
    if (
        !event.success ||
        !Number.isSafeInteger(attempt) ||
        attempt < 1 ||
        !Number.isSafeInteger(Number(event.output.inputs.issue))
    )
        throw new AppError("invalid_input");
    const client = new GitHubClient(process.env.GH_TOKEN ?? "");
    await runPersonalChat(
        client,
        {
            repository: process.env.GITHUB_REPOSITORY ?? "",
            runId: process.env.GITHUB_RUN_ID ?? "",
            userId: process.env.GITHUB_ACTOR_ID ?? "",
            ref: process.env.GITHUB_REF ?? "",
            requestId: event.output.inputs.request_id,
            attempt,
            issue: Number(event.output.inputs.issue),
        },
        process.env.SHARED_CLAUDE_TOKEN ?? "",
        signal,
    );
    return { kind: "chat_stopped", requestId: event.output.inputs.request_id };
});

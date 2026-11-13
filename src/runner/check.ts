import { readFile, stat } from "node:fs/promises";
import * as v from "valibot";
import { AppError, publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";

const lifetime = new AbortController();
const cancel = () => lifetime.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== "--api-origin"))
        throw new AppError("invalid_input");
    if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") throw new AppError("unsafe_execution");
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath || (await stat(eventPath)).size > 1_000_000) throw new AppError("invalid_input");
    const raw: unknown = JSON.parse(await readFile(eventPath, { encoding: "utf8", signal: lifetime.signal }));
    const parsed = v.safeParse(
        v.object({
            inputs: v.object({ mode: v.literal("check"), request_id: v.pipe(v.string(), v.uuid()) }),
        }),
        raw,
    );
    if (!parsed.success) throw new AppError("invalid_input");
    const client = new GitHubClient(process.env.GH_TOKEN ?? "", args[1]);
    const userId = process.env.GITHUB_ACTOR_ID ?? "";
    await client.verifyExecution(
        {
            repository: process.env.GITHUB_REPOSITORY ?? "",
            runId: process.env.GITHUB_RUN_ID ?? "",
            userId,
            ref: process.env.GITHUB_REF ?? "",
            requestId: parsed.output.inputs.request_id,
        },
        lifetime.signal,
    );
    process.stdout.write(
        `${JSON.stringify({ kind: "checked", userId, requestId: parsed.output.inputs.request_id, claude: process.env.SHARED_CLAUDE_AVAILABLE === "true" ? "configured" : "missing", codex: process.env.SHARED_CODEX_AVAILABLE === "true" ? "configured" : "missing", chat: "not_implemented" })}\n`,
    );
} catch (cause) {
    const error = publicError(cause);
    process.stderr.write(`${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`);
    process.exitCode = 1;
} finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
}

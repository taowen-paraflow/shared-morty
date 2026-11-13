import { GitHubClient } from "../shared/github.ts";
import { runClaudeLogin } from "./claude-login.ts";
import { runCommand } from "./command.ts";
import { readIssueExecution } from "./issue-execution.ts";

await runCommand(async (signal) => {
    const execution = await readIssueExecution(signal);
    const client = new GitHubClient(process.env.GH_TOKEN ?? "");
    await runClaudeLogin(client, execution, signal);
    return { kind: "login_completed", requestId: execution.requestId };
});

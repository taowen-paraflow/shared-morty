import { GitHubClient } from "../shared/github.ts";
import { runCommand } from "./command.ts";
import { readIssueExecution } from "./issue-execution.ts";
import { runPersonalChat } from "./personal-chat.ts";

await runCommand(async (signal) => {
    const execution = await readIssueExecution(signal);
    const client = new GitHubClient(process.env.GH_TOKEN ?? "");
    await runPersonalChat(client, execution, process.env.SHARED_CLAUDE_TOKEN ?? "", signal);
    return { kind: "chat_stopped", requestId: execution.requestId };
});

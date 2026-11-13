import { AppError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import { runCommand } from "./command.ts";

function options(args: readonly string[]) {
    const [command, ...flags] = args;
    if (command !== "status") throw new AppError("invalid_input");
    let repository = "";
    let apiOrigin = "https://api.github.com";
    const seen = new Set<string>();
    for (let index = 0; index < flags.length; index += 2) {
        const flag = flags[index];
        const value = flags[index + 1];
        if (flag === undefined || value === undefined || seen.has(flag)) throw new AppError("invalid_input");
        seen.add(flag);
        switch (flag) {
            case "--repository":
                repository = value;
                break;
            case "--api-origin":
                apiOrigin = value;
                break;
            default:
                throw new AppError("invalid_input");
        }
    }
    return { repository, apiOrigin };
}

await runCommand(async (signal) => {
    const input = options(process.argv.slice(2));
    const client = new GitHubClient(process.env.GH_TOKEN ?? "", input.apiOrigin);
    return client.inspectRunner(input.repository, signal);
});

import { AppError, publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";

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

const lifetime = new AbortController();
const cancel = () => lifetime.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
    const input = options(process.argv.slice(2));
    const client = new GitHubClient(process.env.GH_TOKEN ?? "", input.apiOrigin);
    const result = await client.inspectRunner(input.repository, lifetime.signal);
    process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (cause) {
    const error = publicError(cause);
    process.stderr.write(`${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`);
    process.exitCode = 1;
} finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
}

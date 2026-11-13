// External process fixture matching the pinned Claude result and Morty setup NDJSON boundaries.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [program, outcome, ...args] = process.argv.slice(2);
if (process.env.GH_TOKEN || process.env.UNRELATED_SECRET || process.env.GITHUB_TOKEN)
    throw new Error("Unexpected credential reached agent");
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN || !process.env.HOME || !process.env.MORTY_STATE_DIRECTORY)
    throw new Error("Missing agent environment");
const value = (name) => args[args.indexOf(name) + 1];
if (program === "claude") {
    if (outcome === "agent_failure") {
        console.error(process.env.CLAUDE_CODE_OAUTH_TOKEN);
        process.exit(42);
    }
    const session = value("--session-id");
    await writeFile(join(process.cwd(), "session.json"), JSON.stringify({ session }));
    console.log(
        JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: false,
            result: "READY",
            session_id: session,
        }),
    );
} else if (program === "morty" && args[0] === "stop") {
    console.log("Stopped");
} else if (program === "morty" && args[0] === "setup") {
    if (outcome === "morty_failure") {
        console.error(process.env.CLAUDE_CODE_OAUTH_TOKEN);
        process.exit(43);
    }
    const { session } = JSON.parse(await readFile(join(process.cwd(), "session.json"), "utf8"));
    if (session !== value("--session-id") || process.cwd() !== value("--cwd"))
        throw new Error("Session mismatch");
    await mkdir(process.env.MORTY_STATE_DIRECTORY, { recursive: true });
    const url = new URL("https://morty.build/continue");
    url.searchParams.set("harness", "claude");
    url.searchParams.set("sessionId", session);
    url.searchParams.set("workspace", process.cwd());
    url.hash = "code=synthetic-private-morty-transfer";
    console.log(JSON.stringify({ status: "computer_online" }));
    console.log(
        JSON.stringify({
            status: "ready",
            url: outcome === "unsafe_link" ? "https://attacker.example/continue#code=secret" : url.href,
            accessExpiresAt: "2026-11-13T01:00:00.000Z",
        }),
    );
} else throw new Error("Unexpected program command");

// Consume the newly shared Secret in a different VM without creating a model turn.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as v from "valibot";

const execute = promisify(execFile);
const token = process.env.SHARED_CLAUDE_TOKEN ?? "";
if (!/^sk-ant-oat01-[A-Za-z0-9_-]{20,2048}$/u.test(token)) throw new Error("Shared credential is missing or invalid");
const home = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "shared-morty-secret-probe-"));
try {
    const { stdout } = await execute("claude", ["auth", "status", "--json"], {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, TERM: "xterm-256color", BROWSER: "false", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_OAUTH_TOKEN: token },
        timeout: 30_000,
        maxBuffer: 65_536,
    });
    const raw = JSON.parse(stdout);
    const parsed = v.safeParse(v.object({ loggedIn: v.boolean(), authMethod: v.string() }), raw);
    if (!parsed.success || !parsed.output.loggedIn) throw new Error("Official CLI did not confirm authentication");
    const methods = ["oauth_token", "claude_ai", "claude.ai", "api_key", "none"];
    console.log(JSON.stringify({ event: "official_cli.shared_secret", loggedIn: parsed.output.loggedIn, authMethod: methods.includes(parsed.output.authMethod) ? parsed.output.authMethod : "other", tokenCharacters: token.length, modelTurnCreated: false }));
} catch {
    console.error(JSON.stringify({ event: "official_cli.shared_secret_failed" }));
    process.exitCode = 1;
} finally {
    await rm(home, { recursive: true, force: true });
}

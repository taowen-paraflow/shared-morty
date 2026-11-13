// Manual empirical check: status by default; inference requires explicit workflow input.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import * as v from "valibot";

const execute = promisify(execFile);
const mode = process.env.PROBE_MODE ?? "status";
if (mode !== "status" && mode !== "inference") throw new Error("Invalid probe mode");
const token = process.env.SHARED_CLAUDE_TOKEN ?? "";
if (!/^sk-ant-oat01-[A-Za-z0-9_-]{20,2048}$/u.test(token)) throw new Error("Shared credential is missing or invalid");
const home = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "shared-morty-secret-probe-"));
const env = { PATH: process.env.PATH, HOME: home, TERM: "xterm-256color", BROWSER: "false", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_OAUTH_TOKEN: token };
let stage = "authentication";
try {
    const { stdout } = await execute("claude", ["auth", "status", "--json"], {
        cwd: home,
        env,
        timeout: 30_000,
        maxBuffer: 65_536,
    });
    const raw = JSON.parse(stdout);
    const parsed = v.safeParse(v.object({ loggedIn: v.boolean(), authMethod: v.string() }), raw);
    if (!parsed.success || !parsed.output.loggedIn) throw new Error("Official CLI did not confirm authentication");
    const methods = ["oauth_token", "claude_ai", "claude.ai", "api_key", "none"];
    console.log(JSON.stringify({ event: "official_cli.shared_secret", loggedIn: parsed.output.loggedIn, authMethod: methods.includes(parsed.output.authMethod) ? parsed.output.authMethod : "other", tokenCharacters: token.length, modelTurnCreated: false }));
    if (mode === "inference") {
        stage = "inference";
        const response = await execute("claude", [
            "-p", "What is 17 + 26? Reply with only the integer.",
            "--output-format", "json", "--tools", "", "--max-turns", "1",
            "--no-session-persistence", "--model", "sonnet",
        ], { cwd: home, env, timeout: 120_000, maxBuffer: 262_144 });
        const result = v.safeParse(v.object({
            type: v.literal("result"), subtype: v.literal("success"),
            is_error: v.literal(false), result: v.string(),
            num_turns: v.pipe(v.number(), v.integer(), v.minValue(1)),
        }), JSON.parse(response.stdout));
        const matched = result.success && result.output.result.trim() === "43";
        console.log(JSON.stringify({ event: "official_cli.shared_inference", success: result.success,
            answerMatched: matched, modelTurnCreated: result.success,
            turns: result.success ? result.output.num_turns : null }));
        if (!matched) process.exitCode = 1;
    }
} catch (cause) {
    // Never forward CLI stdout/stderr or Error objects to public Actions logs.
    const text = `${typeof cause.stdout === "string" ? cause.stdout : ""} ${typeof cause.stderr === "string" ? cause.stderr : ""}`;
    const category = cause.killed ? "timeout"
        : /rate.?limit|usage.?limit|capacity|overloaded/iu.test(text) ? "capacity_or_limit"
        : /401|403|unauthorized|authentication|invalid.*token/iu.test(text) ? "authentication_or_permission"
        : /model.*not.*found|not.*available.*model/iu.test(text) ? "model_unavailable"
        : "cli_or_provider_failure";
    console.error(JSON.stringify({ event: "official_cli.shared_secret_failed", stage, category }));
    process.exitCode = 1;
} finally {
    await rm(home, { recursive: true, force: true });
}

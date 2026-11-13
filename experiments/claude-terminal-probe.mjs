// Empirical probe: official CLI, synthetic input, no Enter and no account authorization.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import xterm from "@xterm/headless";

const home = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "shared-morty-probe-"));
const terminal = new xterm.Terminal({ cols: 1000, rows: 80, scrollback: 100, allowProposedApi: true });
const child = spawn("script", ["-qefc", "stty cols 1000 rows 80; exec claude setup-token", "/dev/null"], { cwd: home, env: { PATH: process.env.PATH, HOME: home, TERM: "xterm-256color", BROWSER: "false", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" } });
let rendering = Promise.resolve();
let closed = false;
const closing = new Promise(resolve => child.once("close", () => { closed = true; resolve(); }));
const read = () => {
    const buffer = terminal.buffer.active;
    const lines = [];
    for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
    return lines.join("\n");
};
const consume = chunk => { rendering = rendering.then(() => new Promise(resolve => terminal.write(chunk, resolve))); };
child.stdout.on("data", consume);
child.stderr.on("data", consume);
child.stdin.on("error", () => {});
const timeout = setTimeout(() => child.kill("SIGTERM"), 100_000);
try {
    let url;
    for (let count = 0; count < 180; count++) {
        await rendering;
        url = /https:\/\/claude\.(?:com|ai)\/[^\s]*oauth\/authorize[^\s]*/u.exec(read())?.[0];
        if (url || closed) break;
        await wait(500);
    }
    if (!url) throw new Error("No authorization prompt");
    const code = `${"A".repeat(48)}#${"B".repeat(43)}`;
    const before = read();
    child.stdin.write(code);
    await wait(1000);
    await rendering;
    const after = read();
    if (/sk-ant-/u.test(after)) throw new Error("Unexpected credential output; no transcript recorded");
    const urlObject = new URL(url);
    const sanitized = after.replaceAll(url, "<authorization-url-redacted>").replace(/https?:\/\/\S+/gu, "<url-redacted>");
    if (sanitized.includes(urlObject.searchParams.get("state") ?? "UNMATCHABLE") || sanitized.includes(urlObject.searchParams.get("code_challenge") ?? "UNMATCHABLE")) throw new Error("URL redaction incomplete");
    console.log(JSON.stringify({ event: "official_cli.synthetic_input", cliVersion: "2.1.323", columns: 1000, rows: 80, inputCharacters: code.length, beforeCharacters: before.length, afterCharacters: after.length, exactEcho: after.includes(code), joinedEcho: after.replaceAll("\n", "").includes(code), authorizationOrigin: urlObject.origin, authorizationPath: urlObject.pathname, queryKeys: [...urlObject.searchParams.keys()].sort(), nonemptyLines: sanitized.split("\n").filter(line => line.trim()) }));
} finally {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 3000);
    await closing;
    clearTimeout(kill);
    await rendering;
    terminal.dispose();
    await rm(home, { recursive: true, force: true });
}

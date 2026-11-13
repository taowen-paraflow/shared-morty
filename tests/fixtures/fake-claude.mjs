const token = `sk-ant-oat01-${"fixture-token-".repeat(4)}`;
if (process.env.GH_TOKEN || process.env.UNRELATED_SECRET || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    process.stderr.write("OAuth error: unexpected inherited credentials\n");
    process.exit(1);
}
process.stdout.write("\u001b[2J\u001b[HWelcome to Claude Code v2.1.323\r\n");
setImmediate(() => process.stdout.write(authorizationPrompt));
process.stdin.setEncoding("utf8");
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let input = "";
process.stdin.on("data", (chunk) => {
    if (input.length === 0 && /[\r\n]/u.test(chunk)) {
        process.stdout.write("OAuth error: submitted before input was rendered\r\n");
        process.stdin.pause();
        return;
    }
    input += chunk;
    if (!/[\r\n]/u.test(input)) {
        process.stdout.write(
            `\r\u001b[2KPaste code here if prompted > ${"*".repeat(Math.max(0, input.length - 6))}${input.slice(-6)}`,
        );
        return;
    }
    process.stdout.write("\r\n");
    if (input.trim() !== "fixture-good-code#fixture-state") {
        process.stdout.write("OAuth error: Invalid code\r\n");
        process.exitCode = 1;
    } else {
        process.stdout.write(
            `Your OAuth token (valid for 1 year):\r\n${token.slice(0, 35)}\r\n${token.slice(35)}\r\nStore this token securely.\r\n`,
        );
    }
    process.stdin.pause();
});

import { authorizationPrompt } from "./claude-transcript.ts";

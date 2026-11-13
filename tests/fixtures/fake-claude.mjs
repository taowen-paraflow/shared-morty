const token = `sk-ant-oat01-${"fixture-token-".repeat(4)}`;
if (process.env.GH_TOKEN || process.env.UNRELATED_SECRET || process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    process.stderr.write("OAuth error: unexpected inherited credentials\n");
    process.exit(1);
}
process.stdout.write(
    "\u001b[2J\u001b[Hhttps://claude.com/oauth/authorize?state=fixture-sensitive-state\r\nPaste code here:\r\n",
);
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
        process.stdout.write(input);
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

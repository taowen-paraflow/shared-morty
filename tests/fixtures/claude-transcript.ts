// Prompt and input masking observed with the official 2.1.323 Linux binary.
// OAuth parameters below are deliberately synthetic; no account credentials are recorded.
const parameters = new URLSearchParams({
    code: "true",
    client_id: "00000000-0000-4000-8000-000000000000",
    response_type: "code",
    redirect_uri: "https://platform.claude.com/oauth/code/callback",
    scope: "user:inference",
    code_challenge: "S".repeat(43),
    code_challenge_method: "S256",
    state: "fixture-sensitive-state".padEnd(43, "S"),
});
export const authorizationUrl = `https://claude.com/cai/oauth/authorize?${parameters}`;
export const authorizationPrompt = `This will guide you through long-lived (1-year) auth token setup for your Claude account. Claude subscription required.\r\nBrowser didn't open? Use the url below to sign in (c to copy)\r\n${authorizationUrl}\r\nHold Shift while selecting to use your terminal's native copy\r\nPaste code here if prompted > `;
export const authorizationCode = `${"fixture-good-code-".padEnd(48, "C")}#${"fixture-state-".padEnd(43, "S")}`;
const tokenPrefix = "sk-ant-oat01-";
export const syntheticToken = `${tokenPrefix}${"fixture-token-".repeat(10).slice(0, 108 - tokenPrefix.length)}`;

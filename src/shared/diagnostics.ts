import type { ErrorCode } from "./errors.ts";

export type TerminalMarker =
    | "authorization_url"
    | "paste_code"
    | "browser_open_failed"
    | "theme_prompt"
    | "trust_prompt"
    | "login_method_prompt"
    | "token_header"
    | "token_advice"
    | "provider_error"
    | "press_enter"
    | "copy_prompt";

export interface TerminalObservation {
    readonly characters: number;
    readonly lines: number;
    readonly markers: readonly TerminalMarker[];
}

export type Diagnostic =
    | {
          readonly event: "github.response";
          readonly method: "GET" | "POST" | "PUT" | "PATCH";
          readonly resource:
              | "identity"
              | "repository"
              | "workflow_runs"
              | "workflow_run"
              | "workflow_dispatch"
              | "issue"
              | "issue_comments"
              | "secret_public_key"
              | "shared_claude_secret"
              | "other";
          readonly status: number;
      }
    | {
          readonly event: "terminal.started";
          readonly transport: "pty" | "pipe";
          readonly columns: number;
          readonly rows: number;
      }
    | {
          readonly event: "terminal.output";
          readonly stream: "stdout" | "stderr";
          readonly bytes: number;
          readonly totalBytes: number;
          readonly screen: TerminalObservation;
      }
    | {
          readonly event: "terminal.exit";
          readonly code: number | null;
          readonly signal: string | null;
          readonly totalBytes: number;
      }
    | {
          readonly event: "terminal.input";
          readonly kind: "authorization_code" | "enter";
          readonly characters: number;
      }
    | { readonly event: "terminal.input_echo"; readonly matched: true; readonly mode: "plain" | "masked" }
    | {
          readonly event: "terminal.outcome";
          readonly kind: "token" | "provider_error";
          readonly characters: number;
      }
    | {
          readonly event: "login.stage";
          readonly stage:
              | "verifying_execution"
              | "execution_verified"
              | "request_verified"
              | "waiting_for_authorization_url"
              | "waiting_for_code"
              | "completing_authorization"
              | "completed"
              | "cleaned_up";
          readonly runId: string;
          readonly attempt: number;
          readonly issue: number;
      }
    | {
          readonly event: "login.comments";
          readonly total: number;
          readonly ownerComments: number;
          readonly matchingCodes: number;
      }
    | {
          readonly event: "login.message_sent";
          readonly kind: "challenge" | "token" | "error";
          readonly ciphertextCharacters: number;
      }
    | { readonly event: "login.failed"; readonly code: ErrorCode };

export type DiagnosticSink = (record: Diagnostic) => void;

export const writeDiagnostic: DiagnosticSink = (record) => {
    if (typeof process !== "undefined" && process.env.SHARED_MORTY_DIAGNOSTICS === "1") {
        process.stderr.write(`${JSON.stringify(record)}\n`);
    }
};

export function githubResource(
    pathname: string,
): Extract<Diagnostic, { readonly event: "github.response" }>["resource"] {
    const path = pathname.split("?")[0] ?? "";
    if (path === "/user") return "identity";
    if (/\/actions\/secrets\/public-key$/u.test(path)) return "secret_public_key";
    if (/\/actions\/secrets\/SHARED_CLAUDE_TOKEN$/u.test(path)) return "shared_claude_secret";
    if (/\/actions\/workflows\/[^/]+\/dispatches$/u.test(path)) return "workflow_dispatch";
    if (/\/actions\/runs$/u.test(path)) return "workflow_runs";
    if (/\/actions\/runs\/\d+(?:\/cancel)?$/u.test(path)) return "workflow_run";
    if (/\/issues\/\d+\/comments$/u.test(path)) return "issue_comments";
    if (/\/issues(?:\/\d+)?$/u.test(path)) return "issue";
    if (/^\/repos\/[^/]+\/[^/]+$/u.test(path)) return "repository";
    return "other";
}

export function observeTerminal(text: string): TerminalObservation {
    const patterns: readonly { readonly name: TerminalMarker; readonly pattern: RegExp }[] = [
        { name: "authorization_url", pattern: /https:\/\/claude\.(?:com|ai)\//u },
        { name: "paste_code", pattern: /(?:paste|enter)\s+(?:the\s+)?code/iu },
        { name: "browser_open_failed", pattern: /browser didn.t open|could not.*(?:open|launch).*browser/iu },
        {
            name: "theme_prompt",
            pattern: /choose.*(?:text style|theme)|select.*(?:text style|theme)|dark mode|light mode/iu,
        },
        { name: "trust_prompt", pattern: /do you trust|trust.*(?:folder|directory|workspace)/iu },
        {
            name: "login_method_prompt",
            pattern: /select.*login|choose.*login|claude account with subscription/iu,
        },
        { name: "token_header", pattern: /valid for 1 year/u },
        { name: "token_advice", pattern: /store this token/iu },
        {
            name: "provider_error",
            pattern: /OAuth error|invalid (?:code|grant)|connection error|certificate|unable to connect/iu,
        },
        { name: "press_enter", pattern: /press (?:enter|return)|hit (?:enter|return)/iu },
        { name: "copy_prompt", pattern: /copy.*(?:clipboard|link)|(?:clipboard|link).*copy/iu },
    ];
    return {
        characters: text.length,
        lines: text.split("\n").filter((line) => line.trim()).length,
        markers: patterns.filter((item) => item.pattern.test(text)).map((item) => item.name),
    };
}

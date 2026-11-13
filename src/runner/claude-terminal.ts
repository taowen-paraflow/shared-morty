import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import xterm from "@xterm/headless";
import * as v from "valibot";
import { withDeadline } from "../shared/async.ts";
import { type DiagnosticSink, observeTerminal, writeDiagnostic } from "../shared/diagnostics.ts";
import { AppError } from "../shared/errors.ts";
import { authorizationUrl, codeSchema } from "../shared/login-protocol.ts";

export interface TerminalOptions {
    readonly command: string;
    readonly args: readonly string[];
    readonly env: Readonly<NodeJS.ProcessEnv>;
    readonly cwd: string;
    readonly transport: "pty" | "pipe";
    readonly diagnostic?: DiagnosticSink;
}

type ProcessState =
    | { readonly kind: "running" }
    | { readonly kind: "closed" }
    | { readonly kind: "failed"; readonly error: AppError };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class ClaudeTerminal {
    readonly #child: ChildProcessWithoutNullStreams;
    readonly #screen = new xterm.Terminal({ cols: 1000, rows: 80, scrollback: 100, allowProposedApi: true });
    readonly #changes = new EventEmitter();
    readonly #closed: Promise<void>;
    #state: ProcessState = { kind: "running" };
    #rendering: Promise<void> = Promise.resolve();
    #bytes = 0;
    #lastObservation = "";
    readonly #diagnostic: DiagnosticSink;

    constructor(options: TerminalOptions) {
        this.#diagnostic = options.diagnostic ?? writeDiagnostic;
        const shell = `stty cols 1000 rows 80; exec ${[options.command, ...options.args].map(quote).join(" ")}`;
        try {
            this.#child =
                options.transport === "pty"
                    ? spawn("script", ["-qefc", shell, "/dev/null"], { cwd: options.cwd, env: options.env })
                    : spawn(options.command, [...options.args], { cwd: options.cwd, env: options.env });
        } catch (cause) {
            this.#screen.dispose();
            throw new AppError("provider_failed", cause);
        }
        this.#child.stdin.on("error", () => {});
        this.#closed = new Promise((resolve) => {
            this.#child.once("error", (cause) => {
                this.#state = { kind: "failed", error: new AppError("provider_failed", cause) };
                this.#changes.emit("change");
                resolve();
            });
            this.#child.once("close", (code, signal) => {
                this.#diagnostic({ event: "terminal.exit", code, signal, totalBytes: this.#bytes });
                void this.#rendering.finally(() => {
                    if (this.#state.kind === "running") this.#state = { kind: "closed" };
                    this.#changes.emit("change");
                    resolve();
                });
            });
        });
        const consume = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
            this.#bytes += chunk.byteLength;
            if (this.#bytes > 2_000_000) {
                this.#state = { kind: "failed", error: new AppError("provider_failed") };
                this.#changes.emit("change");
                this.#child.kill("SIGTERM");
                return;
            }
            this.#rendering = this.#rendering.then(
                () =>
                    new Promise<void>((resolve) => {
                        this.#screen.write(chunk, () => {
                            const screen = observeTerminal(this.#text());
                            const signature = JSON.stringify(screen);
                            if (signature !== this.#lastObservation) {
                                this.#lastObservation = signature;
                                this.#diagnostic({
                                    event: "terminal.output",
                                    stream,
                                    bytes: chunk.byteLength,
                                    totalBytes: this.#bytes,
                                    screen,
                                });
                            }
                            this.#changes.emit("change");
                            resolve();
                        });
                    }),
            );
        };
        this.#child.stdout.on("data", consume("stdout"));
        this.#child.stderr.on("data", consume("stderr"));
        this.#diagnostic({
            event: "terminal.started",
            transport: options.transport,
            columns: 1000,
            rows: 80,
        });
    }

    readonly #text = (): string => {
        const buffer = this.#screen.buffer.active;
        const lines: string[] = [];
        for (let index = 0; index < buffer.length; index++)
            lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
        return lines.join("\n");
    };

    readonly #find = <T>(find: (text: string) => T | undefined, signal: AbortSignal): Promise<T> => {
        return new Promise((resolve, reject) => {
            const dispose = () => {
                this.#changes.removeListener("change", changed);
                signal.removeEventListener("abort", aborted);
            };
            const aborted = () => {
                dispose();
                reject(new AppError("cancelled", signal.reason));
            };
            const changed = () => {
                try {
                    if (signal.aborted) {
                        aborted();
                        return;
                    }
                    const found = find(this.#text());
                    if (found !== undefined) {
                        dispose();
                        resolve(found);
                        return;
                    }
                    if (this.#state.kind !== "running")
                        throw this.#state.kind === "failed"
                            ? this.#state.error
                            : new AppError("provider_failed");
                } catch (cause) {
                    dispose();
                    reject(cause);
                }
            };
            this.#changes.on("change", changed);
            signal.addEventListener("abort", aborted, { once: true });
            changed();
        });
    };

    readonly authorization = (signal: AbortSignal): Promise<string> =>
        this.#find((text) => {
            const url = /https:\/\/claude\.(?:com|ai)\/[^\s]*oauth\/authorize[^\s]*/u.exec(text)?.[0];
            return url === undefined ? undefined : authorizationUrl(url);
        }, signal);

    readonly complete = async (code: string, signal: AbortSignal): Promise<string> => {
        const parsed = v.safeParse(codeSchema, { code });
        if (!parsed.success) throw new AppError("invalid_input");
        if (signal.aborted) throw new AppError("cancelled", signal.reason);
        this.#diagnostic({ event: "terminal.input", kind: "authorization_code", characters: code.length });
        this.#child.stdin.write(code);
        await withDeadline(10_000, signal, (inputSignal) =>
            this.#find((text) => (text.replaceAll("\n", "").includes(code) ? true : undefined), inputSignal),
        );
        this.#diagnostic({ event: "terminal.input_echo", matched: true });
        this.#diagnostic({ event: "terminal.input", kind: "enter", characters: 1 });
        this.#child.stdin.write("\r");
        return this.#find((text) => {
            if (/OAuth error|[Ii]nvalid (?:code|grant)/u.test(text)) {
                this.#diagnostic({ event: "terminal.outcome", kind: "provider_error", characters: 0 });
                throw new AppError("provider_failed");
            }
            const lines = text.split("\n");
            const start = lines.findIndex((line) => line.includes("valid for 1 year"));
            const end = lines.findIndex((line, index) => index > start && line.includes("Store this token"));
            if (start < 0 || end < 0) return undefined;
            const token = /sk-ant-oat01-[A-Za-z0-9_-]{20,2048}/u.exec(
                lines
                    .slice(start + 1, end)
                    .map((line) => line.trim())
                    .join(""),
            )?.[0];
            if (token)
                this.#diagnostic({ event: "terminal.outcome", kind: "token", characters: token.length });
            return token;
        }, signal);
    };

    readonly dispose = async (): Promise<void> => {
        this.#child.kill("SIGTERM");
        const timer = setTimeout(() => this.#child.kill("SIGKILL"), 3000);
        try {
            await this.#closed;
        } finally {
            clearTimeout(timer);
            this.#changes.removeAllListeners();
            this.#screen.dispose();
        }
    };
}

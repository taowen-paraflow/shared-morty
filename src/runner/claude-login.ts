import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { wait, withDeadline } from "../shared/async.ts";
import { type DiagnosticSink, writeDiagnostic } from "../shared/diagnostics.ts";
import { AppError, publicError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import { createLoginKey, open, seal } from "../shared/login-crypto.ts";
import {
    codeSchema,
    LOGIN_LIFETIME_MS,
    type LoginHeader,
    type LoginMessage,
    loginContext,
    loginMessageSchema,
    tokenSchema,
} from "../shared/login-protocol.ts";
import { repositoryName } from "../shared/runner-status.ts";
import { ClaudeTerminal } from "./claude-terminal.ts";

export interface LoginExecution {
    readonly repository: string;
    readonly runId: string;
    readonly userId: string;
    readonly ref: string;
    readonly requestId: string;
    readonly attempt: number;
    readonly issue: number;
}
interface LoginRuntime {
    readonly diagnostic?: DiagnosticSink;
    readonly clock: {
        readonly now: () => number;
        readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    };
    readonly program: {
        readonly command: string;
        readonly args: readonly string[];
        readonly transport: "pty" | "pipe";
    };
}
const runtime: LoginRuntime = {
    clock: { now: Date.now, wait },
    program: { command: "claude", args: ["setup-token"], transport: "pty" },
};

export async function runClaudeLogin(
    client: GitHubClient,
    input: LoginExecution,
    signal: AbortSignal,
    options: LoginRuntime = runtime,
): Promise<void> {
    const diagnostic = options.diagnostic ?? writeDiagnostic;
    const stage = (
        value:
            | "verifying_execution"
            | "execution_verified"
            | "request_verified"
            | "waiting_for_authorization_url"
            | "waiting_for_code"
            | "completing_authorization"
            | "completed"
            | "cleaned_up",
    ) =>
        diagnostic({
            event: "login.stage",
            stage: value,
            runId: input.runId,
            attempt: input.attempt,
            issue: input.issue,
        });
    stage("verifying_execution");
    await client.verifyExecution({ ...input, workflow: "login" }, signal);
    stage("execution_verified");
    const repository = repositoryName(input.repository);
    const channel = client.loginChannel(repository);
    const request = await channel.request(input.issue, input.userId, input.requestId, signal);
    stage("request_verified");
    const remaining = request.expiresAt - options.clock.now();
    if (remaining <= 0 || remaining > LOGIN_LIFETIME_MS) throw new AppError("timeout");
    const key = await createLoginKey();
    const directory = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "shared-morty-claude-login-"));
    let terminal: ClaudeTerminal;
    try {
        terminal = new ClaudeTerminal({
            ...options.program,
            diagnostic,
            cwd: directory,
            env: {
                PATH: process.env.PATH ?? "",
                HOME: directory,
                USERPROFILE: directory,
                TMPDIR: directory,
                TEMP: directory,
                TERM: "xterm-256color",
                BROWSER: "false",
                DISABLE_AUTOUPDATER: "1",
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            },
        });
    } catch (cause) {
        await rm(directory, { recursive: true, force: true });
        throw cause;
    }
    const send = async (kind: "challenge" | "token" | "error", data: unknown, sendSignal: AbortSignal) => {
        const header: LoginHeader = {
            version: 1,
            kind,
            requestId: input.requestId,
            runId: input.runId,
            attempt: input.attempt,
            expiresAt: request.expiresAt,
        };
        const payload = await seal(request.publicKey, data, loginContext(repository, input.issue, header));
        await channel.send(input.issue, { ...header, payload }, sendSignal);
        diagnostic({ event: "login.message_sent", kind, ciphertextCharacters: payload.data.length });
    };
    try {
        await withDeadline(remaining, signal, async (loginSignal) => {
            stage("waiting_for_authorization_url");
            const url = await withDeadline(Math.min(90_000, remaining), loginSignal, terminal.authorization);
            await send("challenge", { url, publicKey: key.publicKey }, loginSignal);
            stage("waiting_for_code");
            for (;;) {
                const codes: LoginMessage[] = [];
                const comments = await channel.comments(input.issue, loginSignal);
                for (const comment of comments) {
                    if (String(comment.user?.id) !== input.userId || comment.user?.type !== "User") continue;
                    let raw: unknown;
                    try {
                        raw = JSON.parse(comment.body);
                    } catch {
                        continue;
                    }
                    const parsed = v.safeParse(loginMessageSchema, raw);
                    if (
                        !parsed.success ||
                        parsed.output.requestId !== input.requestId ||
                        parsed.output.kind !== "code"
                    )
                        continue;
                    if (
                        parsed.output.runId !== input.runId ||
                        parsed.output.attempt !== input.attempt ||
                        parsed.output.expiresAt !== request.expiresAt
                    )
                        continue;
                    codes.push(parsed.output);
                }
                diagnostic({
                    event: "login.comments",
                    total: comments.length,
                    ownerComments: comments.filter((comment) => String(comment.user?.id) === input.userId)
                        .length,
                    matchingCodes: codes.length,
                });
                const code = codes[0];
                if (codes.length > 1) throw new AppError("invalid_response");
                if (code) {
                    if (options.clock.now() >= request.expiresAt) throw new AppError("timeout");
                    const parsed = v.safeParse(
                        codeSchema,
                        await open(key.privateKey, code.payload, loginContext(repository, input.issue, code)),
                    );
                    if (!parsed.success) throw new AppError("invalid_response");
                    stage("completing_authorization");
                    const token = await terminal.complete(parsed.output.code, loginSignal);
                    if (!v.safeParse(tokenSchema, { token }).success) throw new AppError("provider_failed");
                    await send("token", { token }, loginSignal);
                    stage("completed");
                    return;
                }
                await options.clock.wait(3000, loginSignal);
            }
        });
    } catch (cause) {
        const error = publicError(cause);
        diagnostic({ event: "login.failed", code: error.code });
        try {
            await withDeadline(10_000, new AbortController().signal, (cleanupSignal) =>
                send("error", { code: error.code }, cleanupSignal),
            );
        } catch {
            /* The CLI still reports the sanitized failure. */
        }
        throw cause;
    } finally {
        try {
            await terminal.dispose();
        } finally {
            await rm(directory, { recursive: true, force: true });
            try {
                await withDeadline(10_000, new AbortController().signal, (cleanupSignal) =>
                    channel.close(input.issue, cleanupSignal),
                );
            } catch {
                /* A failed close must not change the authorization result. */
            }
            stage("cleaned_up");
        }
    }
}

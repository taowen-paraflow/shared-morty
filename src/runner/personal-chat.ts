import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { wait, withDeadline } from "../shared/async.ts";
import type { ChatGitHub } from "../shared/chat-github.ts";
import { CHAT_LIFETIME_MS, type ChatHeader, chatContext, chatStopSchema } from "../shared/chat-protocol.ts";
import { type DiagnosticSink, writeDiagnostic } from "../shared/diagnostics.ts";
import { AppError, publicError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import { seal } from "../shared/login-crypto.ts";
import { parseJson, tokenSchema } from "../shared/login-protocol.ts";
import type { IssueExecution } from "./issue-execution.ts";
import {
    type AgentPrograms,
    agentPrograms,
    connectPersonalMorty,
    startPersonalAgent,
    stopPersonalMorty,
} from "./personal-agent.ts";

interface ChatRuntime {
    readonly programs: AgentPrograms;
    readonly clock: {
        readonly now: () => number;
        readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    };
    readonly diagnostic: DiagnosticSink;
}
const runtime: ChatRuntime = {
    programs: agentPrograms,
    clock: { now: Date.now, wait },
    diagnostic: writeDiagnostic,
};
export async function runPersonalChat(
    client: GitHubClient,
    input: IssueExecution,
    token: string,
    signal: AbortSignal,
    options: ChatRuntime = runtime,
): Promise<void> {
    const stage = (
        value: Extract<Parameters<DiagnosticSink>[0], { readonly event: "chat.stage" }>["stage"],
    ) => options.diagnostic({ event: "chat.stage", stage: value });
    await client.verifyExecution({ ...input, workflow: "chat" }, signal);
    stage("execution_verified");
    const channel = client.chatChannel(input.repository);
    const request = await channel.request(input.issue, input.userId, input.requestId, signal);
    const remaining = request.expiresAt - options.clock.now();
    if (remaining <= 0 || remaining > CHAT_LIFETIME_MS) throw new AppError("timeout");
    stage("request_verified");
    const send = async (kind: ChatHeader["kind"], data: unknown, sendSignal: AbortSignal) => {
        const header: ChatHeader = {
            version: 1,
            purpose: "claude_chat",
            kind,
            requestId: input.requestId,
            runId: input.runId,
            attempt: input.attempt,
            expiresAt: request.expiresAt,
        };
        const payload = await seal(
            request.publicKey,
            data,
            chatContext(input.repository, input.issue, header),
        );
        await channel.send(input.issue, { ...header, payload }, sendSignal);
    };
    const directory = await mkdtemp(
        join(process.env.RUNNER_TEMP ?? tmpdir(), `shared-morty-${input.userId}-chat-`),
    );
    const workspace = join(directory, "workspace");
    const environment = {
        cwd: workspace,
        env: {
            PATH: process.env.PATH ?? "",
            HOME: directory,
            USERPROFILE: directory,
            TMPDIR: directory,
            TEMP: directory,
            TERM: "xterm-256color",
            BROWSER: "false",
            NO_BROWSER: "1",
            DISABLE_AUTOUPDATER: "1",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            CLAUDE_CODE_OAUTH_TOKEN: token,
            MORTY_STATE_DIRECTORY: join(directory, "morty"),
        },
    };
    try {
        await mkdir(workspace);
        if (!v.safeParse(tokenSchema, { token }).success) throw new AppError("shared_credential_missing");
        await withDeadline(remaining, signal, async (chatSignal) => {
            stage("starting_agent");
            const session = await startPersonalAgent(environment, options.programs, chatSignal);
            stage("connecting_morty");
            const ready = await connectPersonalMorty(environment, options.programs, session, chatSignal);
            await send("ready", ready, chatSignal);
            stage("ready");
            await waitForChatStop(channel, input, request.expiresAt, chatSignal, options.clock);
        });
    } catch (cause) {
        const error = publicError(cause);
        options.diagnostic({ event: "chat.failed", code: error.code });
        try {
            if (error.code !== "cancelled")
                await withDeadline(8_000, new AbortController().signal, (cleanup) =>
                    send("error", { code: error.code }, cleanup),
                );
        } catch {
            /* Best effort encrypted outcome; never log raw provider errors. */
        }
        if (error.code !== "cancelled" && error.code !== "timeout") throw error;
    } finally {
        try {
            await stopPersonalMorty(environment, options.programs);
        } catch {
            /* The isolated job VM is also destroyed on exit. */
        }
        stage("stopped");
        try {
            await withDeadline(8_000, new AbortController().signal, async (cleanup) => {
                await send("stopped", {}, cleanup);
                await channel.close(input.issue, cleanup);
            });
        } catch {
            /* Remote cleanup may be unavailable; the task still exits. */
        }
        await rm(directory, { recursive: true, force: true });
        stage("cleaned_up");
    }
}

async function waitForChatStop(
    channel: ChatGitHub,
    input: IssueExecution,
    expiresAt: number,
    signal: AbortSignal,
    clock: ChatRuntime["clock"],
): Promise<void> {
    while (clock.now() < expiresAt) {
        for (const comment of await channel.comments(input.issue, signal)) {
            if (String(comment.user?.id) !== input.userId || comment.user?.type !== "User") continue;
            let raw: unknown;
            try {
                raw = parseJson(comment.body);
            } catch {
                continue;
            }
            const stop = v.safeParse(chatStopSchema, raw);
            if (
                stop.success &&
                stop.output.requestId === input.requestId &&
                stop.output.runId === input.runId &&
                stop.output.attempt === input.attempt &&
                stop.output.expiresAt === expiresAt
            )
                return;
        }
        await clock.wait(Math.min(30_000, expiresAt - clock.now()), signal);
    }
}

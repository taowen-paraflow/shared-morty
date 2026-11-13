import * as v from "valibot";
import {
    CHAT_LIFETIME_MS,
    type ChatHeader,
    type ChatRequest,
    chatContext,
    chatErrorSchema,
    chatMessageSchema,
    chatReadySchema,
    mortyUrl,
} from "../shared/chat-protocol.ts";
import { AppError, publicError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import { createLoginKey, type LoginKey, open } from "../shared/login-crypto.ts";
import { ACTIONS_BOT_ID, parseJson } from "../shared/login-protocol.ts";
import { assertNever } from "../shared/runner-status.ts";

interface ChatContext {
    readonly repository: string;
    readonly issue: number;
    readonly request: ChatRequest;
    readonly key: LoginKey;
}
export type PersonalChat =
    | { readonly kind: "waiting"; readonly context: ChatContext; readonly notice: string }
    | {
          readonly kind: "ready";
          readonly context: ChatContext;
          readonly header: ChatHeader;
          readonly url: string;
          readonly accessExpiresAt: string;
          readonly notice: string;
      }
    | { readonly kind: "stopping"; readonly context: ChatContext; readonly notice: string }
    | { readonly kind: "stopped"; readonly notice: string }
    | { readonly kind: "failed"; readonly notice: string };

export async function beginPersonalChat(
    client: GitHubClient,
    repository: string,
    signal: AbortSignal,
): Promise<PersonalChat> {
    const inspection = await client.inspectRunner(repository, signal);
    if (inspection.runner.kind !== "idle") throw new AppError("runner_busy");
    const key = await createLoginKey();
    const request: ChatRequest = {
        version: 1,
        purpose: "claude_chat",
        requestId: crypto.randomUUID(),
        userId: inspection.user.id,
        publicKey: key.publicKey,
        expiresAt: Date.now() + CHAT_LIFETIME_MS,
    };
    const channel = client.chatChannel(repository);
    const issue = await channel.create(request, signal);
    const context = { repository, issue, request, key };
    try {
        await channel.dispatch(request, issue, signal);
    } catch (cause) {
        return {
            kind: "waiting",
            context,
            notice: `${publicError(cause).message} 提交结果未确认，请刷新聊天状态，不要重复启动。`,
        };
    }
    return { kind: "waiting", context, notice: "个人 Claude 正在启动，请刷新聊天状态。" };
}

type ChatOutcome =
    | { readonly kind: "none" }
    | Extract<PersonalChat, { readonly kind: "ready" | "stopped" | "failed" }>;

async function readChatOutcome(
    client: GitHubClient,
    context: ChatContext,
    signal: AbortSignal,
): Promise<ChatOutcome> {
    let outcome: ChatOutcome = { kind: "none" };
    for (const comment of await client.chatChannel(context.repository).comments(context.issue, signal)) {
        if (comment.user?.id !== ACTIONS_BOT_ID || comment.user.type !== "Bot") continue;
        let raw: unknown;
        try {
            raw = parseJson(comment.body);
        } catch {
            continue;
        }
        const parsed = v.safeParse(chatMessageSchema, raw);
        if (!parsed.success) continue;
        const message = parsed.output;
        if (
            message.requestId !== context.request.requestId ||
            message.expiresAt !== context.request.expiresAt
        )
            continue;
        const { payload, ...header } = message;
        await client.verifyExecution(
            {
                repository: context.repository,
                runId: header.runId,
                userId: context.request.userId,
                ref: await defaultRef(client, context.repository, signal),
                requestId: context.request.requestId,
                workflow: "chat",
                attempt: header.attempt,
            },
            signal,
        );
        const data = await open(
            context.key.privateKey,
            payload,
            chatContext(context.repository, context.issue, header),
        );
        switch (header.kind) {
            case "error": {
                const error = v.safeParse(chatErrorSchema, data);
                if (!error.success) throw new AppError("invalid_response");
                outcome = { kind: "failed", notice: new AppError(error.output.code).message };
                break;
            }
            case "stopped":
                if (!v.safeParse(v.strictObject({}), data).success) throw new AppError("invalid_response");
                if (outcome.kind !== "failed")
                    outcome = { kind: "stopped", notice: "个人聊天已停止，未保存本次历史。" };
                break;
            case "ready": {
                const result = v.safeParse(chatReadySchema, data);
                if (!result.success) throw new AppError("invalid_response");
                const ready: Extract<PersonalChat, { readonly kind: "ready" }> = {
                    kind: "ready",
                    context,
                    header,
                    url: mortyUrl(result.output.url),
                    accessExpiresAt: result.output.accessExpiresAt,
                    notice: "个人 Claude 聊天已就绪。",
                };
                // A later ready message cannot revive a stopped task or hide an earlier failure.
                if (outcome.kind !== "failed" && outcome.kind !== "stopped") outcome = ready;
                break;
            }
            default:
                return assertNever(header.kind);
        }
    }
    return outcome;
}

export async function refreshPersonalChat(
    client: GitHubClient,
    state: PersonalChat,
    signal: AbortSignal,
): Promise<PersonalChat> {
    if (state.kind === "failed" || state.kind === "stopped") return state;
    const { context } = state;
    if (Date.now() >= context.request.expiresAt)
        return { kind: "stopped", notice: "聊天任务已到期，请刷新运行状态后重新启动。" };
    const outcome = await readChatOutcome(client, context, signal);
    if (outcome.kind === "failed" || outcome.kind === "stopped") return outcome;
    if (state.kind === "stopping") {
        const inspection = await client.inspectRunner(context.repository, signal);
        return inspection.runner.kind === "idle"
            ? { kind: "stopped", notice: "个人聊天已停止，未保存本次历史。" }
            : state;
    }
    if (outcome.kind === "ready") {
        const inspection = await client.inspectRunner(context.repository, signal);
        const runs =
            inspection.runner.kind === "active"
                ? [inspection.runner.run]
                : inspection.runner.kind === "conflict"
                  ? inspection.runner.runs
                  : [];
        if (
            !runs.some((run) => String(run.id) === outcome.header.runId) ||
            Date.now() >= Date.parse(outcome.accessExpiresAt)
        )
            return { kind: "stopped", notice: "个人聊天已结束或访问已到期，请刷新运行状态。" };
        return outcome;
    }
    return state;
}

async function defaultRef(client: GitHubClient, repository: string, signal: AbortSignal): Promise<string> {
    const settings = await client.chatChannel(repository).settings(signal);
    return `refs/heads/${settings.default_branch}`;
}

export async function stopPersonalChat(
    client: GitHubClient,
    state: PersonalChat,
    signal: AbortSignal,
    mode: "graceful" | "force" = "graceful",
): Promise<PersonalChat> {
    if (state.kind === "failed" || state.kind === "stopped") return state;
    const { context } = state;
    const inspection = await client.inspectRunner(context.repository, signal);
    if (inspection.runner.kind === "idle")
        return state.kind === "waiting"
            ? { ...state, notice: "任务尚未出现，请稍后刷新并重试停止。" }
            : { kind: "stopped", notice: "当前没有运行中的个人任务。" };
    if (inspection.runner.kind !== "active") throw new AppError("runner_busy");
    const attempt = await client.verifyExecution(
        {
            repository: context.repository,
            runId: String(inspection.runner.run.id),
            userId: context.request.userId,
            ref: await defaultRef(client, context.repository, signal),
            requestId: context.request.requestId,
            workflow: "chat",
        },
        signal,
    );
    if (attempt === undefined) throw new AppError("unsafe_execution");
    if (mode === "force") await client.cancelRunner(context.repository, inspection.runner.run.id, signal);
    else
        await client.chatChannel(context.repository).stop(
            context.issue,
            {
                version: 1,
                purpose: "claude_chat",
                kind: "stop",
                requestId: context.request.requestId,
                runId: String(inspection.runner.run.id),
                attempt,
                expiresAt: context.request.expiresAt,
            },
            signal,
        );
    return {
        kind: "stopping",
        context,
        notice: "停止请求已提交，请刷新聊天状态确认结束；本次历史不会保存。",
    };
}

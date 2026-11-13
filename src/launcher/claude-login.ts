import * as v from "valibot";
import { AppError } from "../shared/errors.ts";
import type { GitHubClient } from "../shared/github.ts";
import { createLoginKey, type LoginKey, open, seal } from "../shared/login-crypto.ts";
import type { LoginGitHub } from "../shared/login-github.ts";
import {
    ACTIONS_BOT_ID,
    authorizationUrl,
    challengeSchema,
    codeSchema,
    LOGIN_LIFETIME_MS,
    type LoginHeader,
    type LoginMessage,
    type LoginRequest,
    loginContext,
    loginErrorSchema,
    loginMessageSchema,
    tokenSchema,
} from "../shared/login-protocol.ts";
import { repositoryName } from "../shared/runner-status.ts";

export interface LoginContext {
    readonly repository: string;
    readonly issue: number;
    readonly request: LoginRequest;
    readonly key: LoginKey;
    readonly channel: LoginGitHub;
}
interface Challenge {
    readonly runId: string;
    readonly attempt: number;
    readonly url: string;
    readonly publicKey: string;
}
export type ClaudeLoginState =
    | { readonly kind: "waiting"; readonly context: LoginContext; readonly notice: string }
    | {
          readonly kind: "authorizing";
          readonly context: LoginContext;
          readonly challenge: Challenge;
          readonly notice: string;
      }
    | {
          readonly kind: "waiting_token";
          readonly context: LoginContext;
          readonly challenge: Challenge;
          readonly notice: string;
      }
    | {
          readonly kind: "authorized";
          readonly context: LoginContext;
          readonly token: string;
          readonly notice: string;
      }
    | { readonly kind: "shared" }
    | { readonly kind: "failed"; readonly notice: string };

export async function beginClaudeLogin(
    client: GitHubClient,
    repository: string,
    signal: AbortSignal,
): Promise<ClaudeLoginState> {
    const name = repositoryName(repository);
    const inspection = await client.inspectRunner(name, signal);
    if (inspection.runner.kind !== "idle") throw new AppError("runner_busy");
    const channel = client.loginChannel(name);
    const settings = await channel.settings(signal);
    await channel.publicKey(signal);
    const key = await createLoginKey();
    if (signal.aborted) throw new AppError("cancelled", signal.reason);
    const request: LoginRequest = {
        version: 1,
        requestId: crypto.randomUUID(),
        userId: inspection.user.id,
        publicKey: key.publicKey,
        expiresAt: Date.now() + LOGIN_LIFETIME_MS,
    };
    const issue = await channel.create(request, signal);
    const context: LoginContext = { repository: name, issue, request, key, channel };
    try {
        await channel.dispatch(request, issue, settings.default_branch, signal);
        return { kind: "waiting", context, notice: "" };
    } catch (cause) {
        if (signal.aborted) throw cause;
        return {
            kind: "waiting",
            context,
            notice: "提交结果未确认，请刷新登录状态或到 GitHub 检查任务，勿重复登录。",
        };
    }
}

export async function refreshClaudeLogin(
    client: GitHubClient,
    state: ClaudeLoginState,
    signal: AbortSignal,
): Promise<ClaudeLoginState> {
    if (state.kind === "shared" || state.kind === "failed" || state.kind === "authorized") return state;
    const { context } = state;
    if (Date.now() >= context.request.expiresAt)
        return { kind: "failed", notice: "登录已超时，请返回环境后重新登录。" };
    const messages: LoginMessage[] = [];
    for (const comment of await context.channel.comments(context.issue, signal)) {
        if (comment.user?.id !== ACTIONS_BOT_ID || comment.user.type !== "Bot") continue;
        let raw: unknown;
        try {
            raw = JSON.parse(comment.body);
        } catch {
            continue;
        }
        const parsed = v.safeParse(loginMessageSchema, raw);
        if (
            !parsed.success ||
            parsed.output.requestId !== context.request.requestId ||
            parsed.output.kind === "code"
        )
            continue;
        if (parsed.output.expiresAt !== context.request.expiresAt) throw new AppError("invalid_response");
        messages.push(parsed.output);
    }
    if (messages.length === 0) return state;
    const first = messages[0];
    if (!first) return state;
    const runId = state.kind === "waiting" ? first.runId : state.challenge.runId;
    const attempt = state.kind === "waiting" ? first.attempt : state.challenge.attempt;
    if (messages.some((message) => message.runId !== runId || message.attempt !== attempt))
        throw new AppError("invalid_response");
    await client.verifyExecution(
        {
            repository: context.repository,
            runId,
            attempt,
            userId: context.request.userId,
            requestId: context.request.requestId,
            ref: `refs/heads/${(await context.channel.settings(signal)).default_branch}`,
            workflow: "login",
        },
        signal,
    );
    const failures = messages.filter((message) => message.kind === "error");
    const failure = failures[0];
    if (failure) {
        const parsed = v.safeParse(
            loginErrorSchema,
            await open(
                context.key.privateKey,
                failure.payload,
                loginContext(context.repository, context.issue, failure),
            ),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        return { kind: "failed", notice: new AppError(parsed.output.code).message };
    }
    if (state.kind === "waiting") {
        const challenges = messages.filter((message) => message.kind === "challenge");
        const challenge = challenges[0];
        if (challenges.length !== 1 || !challenge) throw new AppError("invalid_response");
        const parsed = v.safeParse(
            challengeSchema,
            await open(
                context.key.privateKey,
                challenge.payload,
                loginContext(context.repository, context.issue, challenge),
            ),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        return {
            kind: "authorizing",
            context,
            challenge: {
                runId,
                attempt,
                publicKey: parsed.output.publicKey,
                url: authorizationUrl(parsed.output.url),
            },
            notice: "",
        };
    }
    if (state.kind === "waiting_token") {
        const tokens = messages.filter((message) => message.kind === "token");
        const token = tokens[0];
        if (tokens.length === 0) return state;
        if (tokens.length !== 1 || !token) throw new AppError("invalid_response");
        const parsed = v.safeParse(
            tokenSchema,
            await open(
                context.key.privateKey,
                token.payload,
                loginContext(context.repository, context.issue, token),
            ),
        );
        if (!parsed.success) throw new AppError("invalid_response");
        return { kind: "authorized", context, token: parsed.output.token, notice: "" };
    }
    return state;
}

export async function sendClaudeCode(
    state: Extract<ClaudeLoginState, { readonly kind: "authorizing" }>,
    code: string,
    signal: AbortSignal,
): Promise<ClaudeLoginState> {
    const parsed = v.safeParse(codeSchema, { code: code.trim() });
    if (!parsed.success) throw new AppError("invalid_input");
    const { context, challenge } = state;
    if (Date.now() >= context.request.expiresAt) throw new AppError("timeout");
    const header: LoginHeader = {
        version: 1,
        kind: "code",
        requestId: context.request.requestId,
        runId: challenge.runId,
        attempt: challenge.attempt,
        expiresAt: context.request.expiresAt,
    };
    const payload = await seal(
        challenge.publicKey,
        parsed.output,
        loginContext(context.repository, context.issue, header),
    );
    try {
        await context.channel.send(context.issue, { ...header, payload }, signal);
        return { ...state, kind: "waiting_token", notice: "" };
    } catch (cause) {
        if (signal.aborted) throw cause;
        return { ...state, kind: "waiting_token", notice: "授权码发送结果未确认，请刷新状态，勿重复提交。" };
    }
}

export async function cancelClaudeLogin(
    client: GitHubClient,
    state: ClaudeLoginState,
    signal: AbortSignal,
): Promise<ClaudeLoginState> {
    if (state.kind === "shared" || state.kind === "failed") return state;
    if (state.kind === "authorized") return { kind: "failed", notice: "本次登录结果已丢弃。" };
    const { context } = state;
    const inspection = await client.inspectRunner(context.repository, signal);
    if (inspection.runner.kind !== "active") throw new AppError("runner_busy");
    await client.verifyExecution(
        {
            repository: context.repository,
            runId: String(inspection.runner.run.id),
            userId: context.request.userId,
            requestId: context.request.requestId,
            ref: `refs/heads/${(await context.channel.settings(signal)).default_branch}`,
            workflow: "login",
        },
        signal,
    );
    await client.cancelRunner(context.repository, inspection.runner.run.id, signal);
    return { kind: "failed", notice: "已请求停止登录，请返回环境确认任务结束。" };
}

import { EventEmitter, once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import sodium from "libsodium-wrappers";
import * as v from "valibot";
import { chatMessageSchema } from "../../src/shared/chat-protocol.ts";
import { createLoginKey, fromBase64, open, seal, toBase64 } from "../../src/shared/login-crypto.ts";
import {
    ACTIONS_BOT_ID,
    codeSchema,
    type LoginHeader,
    loginContext,
    loginMessageSchema,
    loginRequestSchema,
    parseJson,
} from "../../src/shared/login-protocol.ts";
import {
    authorizationCode,
    authorizationUrl,
    syntheticToken as token,
} from "../fixtures/claude-transcript.ts";

async function body(request: IncomingMessage): Promise<unknown> {
    request.setEncoding("utf8");
    let result = "";
    for await (const chunk of request) {
        if (typeof chunk !== "string" || result.length + chunk.length > 32_000)
            throw new Error("Invalid request");
        result += chunk;
    }
    return parseJson(result);
}

export async function loginGitHubServer(
    options: { readonly private?: boolean; readonly workflow?: "login" | "chat" } = {},
) {
    const workflow = options.workflow ?? "login";
    await sodium.ready;
    const secretKey = sodium.crypto_box_keypair();
    const runnerKey = await createLoginKey();
    let requestBody = "";
    let sharingAllowed = true;
    let savedToken: string | null = null;
    let runStarted = false;
    let runCreated = false;
    let runConclusion = "success";
    let authenticationAllowed = true;
    let userId = 42;
    let dispatchUncertain = false;
    const events = new EventEmitter();
    const comments: {
        readonly id: number;
        readonly body: string;
        readonly user: { readonly id: number; readonly type: string };
    }[] = [];
    const server = createServer(async (request, response) => {
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "private, max-age=60");
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader(
            "access-control-allow-headers",
            "authorization,accept,x-github-api-version,content-type",
        );
        response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,OPTIONS");
        if (request.method === "OPTIONS") {
            response.writeHead(204).end();
            return;
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        const send = (value: unknown) => response.end(JSON.stringify(value));
        try {
            if (
                (!authenticationAllowed || request.headers.authorization !== "Bearer fixture-token") &&
                request.headers.authorization !== "Bearer runner-token"
            ) {
                response.writeHead(401);
                send({});
                return;
            }
            if (url.pathname === "/user") {
                send({ id: userId, login: userId === 42 ? "alice" : "bob" });
                return;
            }
            if (url.pathname === "/repos/team/execution") {
                send({
                    private: options.private ?? true,
                    full_name: "team/execution",
                    default_branch: "main",
                });
                return;
            }
            if (url.pathname.endsWith("/actions/secrets/public-key")) {
                send({ key_id: "key-1", key: toBase64(secretKey.publicKey) });
                return;
            }
            if (url.pathname.endsWith("/actions/secrets/SHARED_CLAUDE_TOKEN") && request.method === "PUT") {
                if (!sharingAllowed) {
                    response.writeHead(403);
                    send({});
                    return;
                }
                const parsed = v.parse(
                    v.object({ key_id: v.literal("key-1"), encrypted_value: v.string() }),
                    await body(request),
                );
                const existed = savedToken !== null;
                savedToken = sodium.to_string(
                    sodium.crypto_box_seal_open(
                        fromBase64(parsed.encrypted_value),
                        secretKey.publicKey,
                        secretKey.privateKey,
                    ),
                );
                response.writeHead(existed ? 204 : 201).end();
                return;
            }
            if (url.pathname.endsWith("/actions/runs/701")) {
                const parsed = v.parse(loginRequestSchema, parseJson(requestBody));
                send({
                    actor: { id: 42 },
                    head_branch: "main",
                    event: "workflow_dispatch",
                    path: `.github/workflows/${workflow}.yml`,
                    display_title: `shared-morty-42-${parsed.requestId}`,
                    run_attempt: 1,
                });
                return;
            }
            if (url.pathname.endsWith("/actions/runs/701/cancel") && request.method === "POST") {
                runStarted = false;
                response.writeHead(202).end();
                return;
            }
            if (url.pathname.endsWith("/actions/runs")) {
                const parsed = requestBody ? v.parse(loginRequestSchema, parseJson(requestBody)) : null;
                send({
                    total_count: runCreated ? 1 : 0,
                    workflow_runs:
                        runCreated && parsed
                            ? [
                                  {
                                      id: 701,
                                      actor: { id: 42 },
                                      status: runStarted ? "in_progress" : "completed",
                                      conclusion: runStarted ? null : runConclusion,
                                      path: `.github/workflows/${workflow}.yml`,
                                      display_title: `shared-morty-42-${parsed.requestId}`,
                                  },
                              ]
                            : [],
                });
                return;
            }
            if (
                url.pathname.endsWith(`/actions/workflows/${workflow}.yml/dispatches`) &&
                request.method === "POST"
            ) {
                const parsed = v.parse(
                    v.object({
                        ref: v.literal("main"),
                        inputs: v.object({ request_id: v.string(), issue: v.string() }),
                    }),
                    await body(request),
                );
                const channel = v.parse(loginRequestSchema, parseJson(requestBody));
                if (parsed.inputs.request_id !== channel.requestId || parsed.inputs.issue !== "601")
                    throw new Error("Dispatch mismatch");
                runStarted = true;
                runCreated = true;
                response.writeHead(dispatchUncertain ? 503 : 204).end();
                return;
            }
            if (url.pathname.endsWith("/issues") && request.method === "POST") {
                const parsed = v.parse(
                    v.object({ title: v.string(), body: v.string() }),
                    await body(request),
                );
                requestBody = parsed.body;
                send({ number: 601 });
                return;
            }
            if (url.pathname.endsWith("/issues/601")) {
                if (request.method === "PATCH") {
                    send({ state: "closed" });
                    return;
                }
                send({
                    number: 601,
                    title: `shared-morty-${workflow}-${v.parse(loginRequestSchema, parseJson(requestBody)).requestId}`,
                    body: requestBody,
                    user: { id: 42 },
                    state: "open",
                });
                return;
            }
            if (url.pathname.endsWith("/issues/601/comments")) {
                if (request.method === "POST") {
                    const parsed = v.parse(v.object({ body: v.string() }), await body(request));
                    comments.push({
                        id: comments.length + 1,
                        body: parsed.body,
                        user:
                            request.headers.authorization === "Bearer runner-token"
                                ? { id: ACTIONS_BOT_ID, type: "Bot" }
                                : { id: 42, type: "User" },
                    });
                    events.emit("comment");
                    send({ id: comments.length });
                    return;
                }
                send(comments);
                return;
            }
            response.writeHead(404);
            send({});
        } catch {
            response.writeHead(422);
            send({ message: "Invalid fixture operation" });
        }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const publish = async (
        kind: "challenge" | "token",
        value: unknown,
        options: {
            readonly authorId?: number;
            readonly attempt?: number;
            readonly contextIssue?: number;
        } = {},
    ) => {
        const parsed = v.parse(loginRequestSchema, parseJson(requestBody));
        const header: LoginHeader = {
            version: 1,
            kind,
            runId: "701",
            attempt: options.attempt ?? 1,
            requestId: parsed.requestId,
            expiresAt: parsed.expiresAt,
        };
        const payload = await seal(
            parsed.publicKey,
            value,
            loginContext("team/execution", options.contextIssue ?? 601, header),
        );
        comments.push({
            id: comments.length + 1,
            body: JSON.stringify({ ...header, payload }),
            user: {
                id: options.authorId ?? ACTIONS_BOT_ID,
                type: options.authorId === undefined ? "Bot" : "User",
            },
        });
        events.emit("comment");
    };
    return {
        origin: `http://127.0.0.1:${address.port}`,
        authorizationUrl,
        authorizationCode,
        token,
        loseDispatchResponse: () => {
            dispatchUncertain = true;
        },
        authenticateAs: (id: number) => {
            userId = id;
        },
        allowAuthentication: (allowed: boolean) => {
            authenticationAllowed = allowed;
        },
        publishChallenge: (
            options: {
                readonly authorId?: number;
                readonly attempt?: number;
                readonly contextIssue?: number;
                readonly url?: string;
            } = {},
        ) =>
            publish(
                "challenge",
                { url: options.url ?? authorizationUrl, publicKey: runnerKey.publicKey },
                options,
            ),
        completeAuthorization: async () => {
            const comment = comments.find((value) => value.user.id === 42);
            if (!comment) throw new Error("Missing code");
            const message = v.parse(loginMessageSchema, parseJson(comment.body));
            const code = v.parse(
                codeSchema,
                await open(
                    runnerKey.privateKey,
                    message.payload,
                    loginContext("team/execution", 601, message),
                ),
            );
            if (code.code !== authorizationCode) throw new Error("Wrong authorization code");
            await publish("token", { token });
        },
        rejectSharing: () => {
            sharingAllowed = false;
        },
        allowSharing: () => {
            sharingAllowed = true;
        },
        sharedToken: () => savedToken,
        finishRun: (conclusion = "success") => {
            runConclusion = conclusion;
            runStarted = false;
        },
        messages: () => JSON.stringify({ requestBody, comments }),
        waitForMessage: (kind: "challenge" | "code" | "token" | "error" | "ready" | "stopped") =>
            new Promise<void>((resolve) => {
                const check = () => {
                    if (
                        comments.some((comment) => {
                            const data = parseJson(comment.body);
                            const parsed = v.safeParse(loginMessageSchema, data);
                            const chat = v.safeParse(chatMessageSchema, data);
                            return (
                                (parsed.success && parsed.output.kind === kind) ||
                                (chat.success && chat.output.kind === kind)
                            );
                        })
                    ) {
                        events.removeListener("comment", check);
                        resolve();
                    }
                };
                events.on("comment", check);
                check();
            }),
        close: async () => {
            events.removeAllListeners();
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        },
    };
}

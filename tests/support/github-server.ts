import { once } from "node:events";
import { createServer } from "node:http";
import * as v from "valibot";

interface FixtureRun {
    readonly id: number;
    readonly actorId: number;
    readonly name: string;
    readonly status: string;
    readonly path?: string;
}

/** A stateful external GitHub system, reached through the real production HTTP client. */
export async function githubServer() {
    let runs: readonly FixtureRun[] = [];
    let privateRepository = true;
    let authentication: "valid" | "invalid" = "valid";
    let representation: "valid" | "invalid" = "valid";
    let requestListener: (() => void) | undefined;
    let nextRunResponse: ((deliver: () => void) => void) | undefined;
    const server = createServer(async (request, response) => {
        response.setHeader("content-type", "application/json");
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader("access-control-allow-headers", "authorization,accept,x-github-api-version");
        if (request.method === "OPTIONS") {
            response.writeHead(204).end();
            return;
        }
        if (authentication === "invalid" || request.headers.authorization !== "Bearer fixture-token") {
            response.writeHead(401).end(JSON.stringify({ message: "fixture-token should never be exposed" }));
            return;
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/repos/team/execution") {
            response.end(
                JSON.stringify({
                    default_branch: "main",
                    private: privateRepository,
                    full_name: "team/execution",
                }),
            );
            return;
        }
        if (url.pathname === "/repos/team/execution/actions/runs/501") {
            response.end(
                JSON.stringify({
                    actor: { id: 42 },
                    event: "workflow_dispatch",
                    head_branch: "main",
                    path: ".github/workflows/runner.yml",
                    display_title: "shared-morty-42-bb46c601-ae8e-4882-bbb8-020051ecde1a",
                }),
            );
            return;
        }
        if (url.pathname === "/user") {
            response.end(JSON.stringify({ id: 42, login: "alice" }));
            return;
        }
        if (
            request.method === "POST" &&
            url.pathname === "/repos/team/execution/actions/workflows/runner.yml/dispatches"
        ) {
            let body = "";
            request.setEncoding("utf8");
            try {
                for await (const chunk of request) {
                    if (typeof chunk !== "string" || body.length + chunk.length > 4096)
                        throw new Error("Invalid dispatch");
                    body += chunk;
                }
                const raw: unknown = JSON.parse(body);
                const parsed = v.safeParse(
                    v.object({
                        ref: v.literal("main"),
                        inputs: v.object({
                            mode: v.literal("check"),
                            request_id: v.pipe(v.string(), v.uuid()),
                        }),
                    }),
                    raw,
                );
                if (!parsed.success) throw new Error("Invalid dispatch");
                runs = [
                    ...runs,
                    {
                        id: 301,
                        actorId: 42,
                        name: `shared-morty-42-${parsed.output.inputs.request_id}`,
                        status: "queued",
                    },
                ];
            } catch {
                response.writeHead(422).end(JSON.stringify({ message: "Invalid dispatch" }));
                return;
            }
            response.writeHead(204).end();
            return;
        }
        const cancellation = /^\/repos\/team\/execution\/actions\/runs\/(\d+)\/cancel$/u.exec(url.pathname);
        if (request.method === "POST" && cancellation) {
            const id = Number(cancellation[1]);
            runs = runs.map((run) => (run.id === id ? { ...run, status: "completed" } : run));
            response.writeHead(202).end();
            return;
        }
        if (url.pathname === "/repos/team/execution/actions/runs") {
            if (requestListener) {
                requestListener();
                return;
            }
            if (representation === "invalid") {
                response.end(JSON.stringify({ total_count: 1, workflow_runs: [{ id: "invalid" }] }));
                return;
            }
            const page = Number(url.searchParams.get("page") ?? "1");
            const payload = JSON.stringify({
                total_count: runs.length,
                workflow_runs: runs.slice((page - 1) * 100, page * 100).map((run) => ({
                    id: run.id,
                    name: "Shared Morty runner",
                    display_title: run.name,
                    status: run.status,
                    actor: { id: run.actorId, login: run.actorId === 42 ? "alice" : "bob" },
                    path: run.path ?? ".github/workflows/runner.yml",
                })),
            });
            const deliver = () => response.end(payload);
            if (nextRunResponse) {
                const hold = nextRunResponse;
                nextRunResponse = undefined;
                hold(deliver);
                return;
            }
            deliver();
            return;
        }
        response.writeHead(404).end(JSON.stringify({ message: "Not found" }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a local TCP address");
    return {
        origin: `http://127.0.0.1:${address.port}`,
        setPrivate: (value: boolean) => {
            privateRepository = value;
        },
        setRuns: (next: readonly FixtureRun[]) => {
            runs = next;
        },
        rejectAuthentication: () => {
            authentication = "invalid";
        },
        invalidateRuns: () => {
            representation = "invalid";
        },
        pauseRuns: () =>
            new Promise<void>((resolve) => {
                requestListener = resolve;
            }),
        holdNextRuns: () => {
            let release = () => {};
            const received = new Promise<void>((resolve) => {
                nextRunResponse = (deliver) => {
                    release = deliver;
                    resolve();
                };
            });
            return { received, release: () => release() };
        },
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        },
    };
}

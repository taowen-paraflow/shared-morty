import { once } from "node:events";
import { createServer } from "node:http";

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
    let authentication: "valid" | "invalid" = "valid";
    let representation: "valid" | "invalid" = "valid";
    let requestListener: (() => void) | undefined;
    const server = createServer((request, response) => {
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
        if (url.pathname === "/user") {
            response.end(JSON.stringify({ id: 42, login: "alice" }));
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
            response.end(
                JSON.stringify({
                    total_count: runs.length,
                    workflow_runs: runs.slice((page - 1) * 100, page * 100).map((run) => ({
                        id: run.id,
                        name: "Shared Morty runner",
                        display_title: run.name,
                        status: run.status,
                        actor: { id: run.actorId, login: run.actorId === 42 ? "alice" : "bob" },
                        path: run.path ?? ".github/workflows/runner.yml",
                    })),
                }),
            );
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
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        },
    };
}

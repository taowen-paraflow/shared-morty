import { AppError } from "./errors.ts";

const API_ORIGIN = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

function apiOrigin(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw new AppError("invalid_input", cause);
    }
    const local = url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (
        (!local && url.origin !== API_ORIGIN) ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
    ) {
        throw new AppError("invalid_input");
    }
    return url.origin;
}

export class GitHubHttp {
    readonly #origin: string;
    readonly #token: string;

    constructor(token: string, origin = API_ORIGIN) {
        if (token.trim().length === 0 || /[\r\n]/u.test(token)) throw new AppError("invalid_input");
        this.#token = token.trim();
        this.#origin = apiOrigin(origin);
    }

    readonly get = (pathname: string, signal: AbortSignal): Promise<unknown> =>
        this.#request(pathname, signal);

    readonly post = (
        pathname: string,
        body: Readonly<Record<string, unknown>>,
        signal: AbortSignal,
    ): Promise<unknown> => this.#request(pathname, signal, body);

    readonly put = (
        pathname: string,
        body: Readonly<Record<string, unknown>>,
        signal: AbortSignal,
    ): Promise<unknown> => this.#request(pathname, signal, body, "PUT");

    readonly patch = (
        pathname: string,
        body: Readonly<Record<string, unknown>>,
        signal: AbortSignal,
    ): Promise<unknown> => this.#request(pathname, signal, body, "PATCH");

    readonly #request = async (
        pathname: string,
        signal: AbortSignal,
        body?: Readonly<Record<string, unknown>>,
        method = body === undefined ? "GET" : "POST",
    ): Promise<unknown> => {
        if (signal.aborted) throw new AppError("cancelled", signal.reason);
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
        const combined = AbortSignal.any([signal, deadline.signal]);
        try {
            const response = await fetch(new URL(pathname, this.#origin), {
                method,
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                headers: {
                    ...(body === undefined ? {} : { "content-type": "application/json" }),
                    accept: "application/vnd.github+json",
                    authorization: `Bearer ${this.#token}`,
                    "x-github-api-version": "2022-11-28",
                },
                redirect: "error",
                signal: combined,
            });
            if (!response.ok) {
                await response.body?.cancel();
                switch (response.status) {
                    case 401:
                        throw new AppError("unauthenticated");
                    case 403:
                        throw new AppError("forbidden");
                    case 404:
                        throw new AppError("repository_unavailable");
                    case 429:
                        throw new AppError("rate_limited");
                    case 409:
                    case 422:
                        throw new AppError("conflict");
                    default:
                        throw new AppError("unavailable");
                }
            }
            if (
                response.status === 204 ||
                response.status === 202 ||
                (method === "PUT" && response.status === 201)
            ) {
                await response.body?.cancel();
                return null;
            }
            const text = await response.text();
            if (text.length > 2_000_000) throw new AppError("invalid_response");
            try {
                const value: unknown = JSON.parse(text);
                return value;
            } catch (cause) {
                throw new AppError("invalid_response", cause);
            }
        } catch (cause) {
            if (signal.aborted) throw new AppError("cancelled", cause);
            if (deadline.signal.aborted) throw new AppError("timeout", cause);
            if (cause instanceof AppError) throw cause;
            throw new AppError("unavailable", cause);
        } finally {
            clearTimeout(timer);
        }
    };
}

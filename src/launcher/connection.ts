import { useEffect, useRef, useState } from "react";
import { AppError, publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import type { UserIdentity } from "../shared/runner-status.ts";
import { recallConnection, rememberConnection } from "./browser-vault.ts";

export interface LauncherOptions {
    readonly apiOrigin?: string;
    readonly clock?: {
        readonly now: () => number;
        readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    };
}
export interface ConnectionInput {
    readonly repository: string;
    readonly token: string;
}
export interface Session {
    readonly id: number;
    readonly client: GitHubClient;
    readonly repository: string;
    readonly user: UserIdentity;
}
type ConnectionState =
    | { readonly kind: "restoring" }
    | { readonly kind: "disconnected" }
    | { readonly kind: "connecting" }
    | { readonly kind: "failed"; readonly error: AppError }
    | { readonly kind: "connected"; readonly session: Session };

export function useConnection(options: LauncherOptions, lifetime: AbortSignal) {
    const [state, setState] = useState<ConnectionState>({ kind: "restoring" });
    const pending = useRef<AbortController | null>(null);
    const sequence = useRef(0);
    useEffect(() => {
        const request = new AbortController();
        pending.current = request;
        const signal = AbortSignal.any([lifetime, request.signal]);
        void (async () => {
            try {
                const saved = await recallConnection(options.apiOrigin, signal);
                if (signal.aborted) return;
                if (!saved) {
                    setState({ kind: "disconnected" });
                    return;
                }
                const client = new GitHubClient(saved.token, options.apiOrigin);
                const connected = await client.connectRepository(saved.repository, signal);
                if (connected.user.id !== saved.userId) throw new AppError("unauthenticated");
                if (!signal.aborted)
                    setState({
                        kind: "connected",
                        session: { id: ++sequence.current, client, ...connected },
                    });
            } catch (cause) {
                if (!signal.aborted) setState({ kind: "failed", error: publicError(cause) });
            } finally {
                if (pending.current === request) pending.current = null;
            }
        })();
        return () => {
            request.abort();
            pending.current?.abort();
        };
    }, [lifetime, options.apiOrigin]);
    const connect = (input: ConnectionInput) => {
        if (lifetime.aborted) return;
        pending.current?.abort();
        const request = new AbortController();
        pending.current = request;
        const signal = AbortSignal.any([lifetime, request.signal]);
        const id = ++sequence.current;
        setState({ kind: "connecting" });
        void (async () => {
            try {
                const client = new GitHubClient(input.token, options.apiOrigin);
                const connected = await client.connectRepository(input.repository, signal);
                await rememberConnection(
                    {
                        version: 1,
                        repository: connected.repository,
                        userId: connected.user.id,
                        token: input.token,
                    },
                    options.apiOrigin,
                    signal,
                );
                if (!signal.aborted) setState({ kind: "connected", session: { id, client, ...connected } });
            } catch (cause) {
                if (!signal.aborted) setState({ kind: "failed", error: publicError(cause) });
            } finally {
                if (pending.current === request) pending.current = null;
            }
        })();
    };
    return { state, connect };
}

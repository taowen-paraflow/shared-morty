import { useEffect, useRef, useState } from "react";
import { type AppError, publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import type { UserIdentity } from "../shared/runner-status.ts";

export interface LauncherOptions {
    readonly apiOrigin?: string;
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
    | { readonly kind: "disconnected" }
    | { readonly kind: "connecting" }
    | { readonly kind: "failed"; readonly error: AppError }
    | { readonly kind: "connected"; readonly session: Session };

export function useConnection(options: LauncherOptions, lifetime: AbortSignal) {
    const [state, setState] = useState<ConnectionState>({ kind: "disconnected" });
    const pending = useRef<AbortController | null>(null);
    const sequence = useRef(0);
    useEffect(
        () => () => {
            pending.current?.abort();
        },
        [],
    );
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

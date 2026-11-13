import { useReducer, useRef } from "react";
import { type AppError, publicError } from "../shared/errors.ts";
import { GitHubClient } from "../shared/github.ts";
import { planOperation, recoverOperation } from "./operations.ts";
import {
    type ConnectionInput,
    isConnected,
    type LauncherAction,
    launcherReducer,
    type SettledState,
} from "./state.ts";

export interface LauncherOptions {
    readonly apiOrigin?: string;
}

export function useLauncher(options: LauncherOptions, lifetime: AbortSignal) {
    const [state, dispatch] = useReducer(launcherReducer, { kind: "disconnected" });
    const pending = useRef<AbortController | null>(null);
    const sequence = useRef(0);

    const execute = async (
        request: AbortController,
        operationId: number,
        run: (signal: AbortSignal) => Promise<SettledState>,
        recover: (error: AppError) => SettledState,
    ) => {
        const signal = AbortSignal.any([lifetime, request.signal]);
        try {
            const next = await run(signal);
            if (!signal.aborted) dispatch({ kind: "finished", operationId, next });
        } catch (cause) {
            if (!signal.aborted)
                dispatch({ kind: "finished", operationId, next: recover(publicError(cause)) });
        } finally {
            if (pending.current === request) pending.current = null;
        }
    };

    const connect = (input: ConnectionInput) => {
        if (lifetime.aborted) return;
        pending.current?.abort();
        const request = new AbortController();
        pending.current = request;
        const operationId = ++sequence.current;
        dispatch({ kind: "connecting", operationId });
        void execute(
            request,
            operationId,
            async (signal) => {
                const client = new GitHubClient(input.token, options.apiOrigin);
                const inspection = await client.inspectRunner(input.repository, signal);
                return { kind: "ready", session: { client, repository: input.repository, inspection } };
            },
            (error) => ({ kind: "failed", error }),
        );
    };

    const act = (action: LauncherAction) => {
        // Prevent duplicate submissions before React commits the pending screen.
        if (lifetime.aborted || pending.current !== null || !isConnected(state)) return;
        const operation = planOperation(state, action);
        if (!operation) return;
        const previous = state;
        const request = new AbortController();
        pending.current = request;
        const operationId = ++sequence.current;
        dispatch({ kind: "working", operationId });
        void execute(request, operationId, operation, (error) => recoverOperation(previous, error));
    };

    return { state, connect, act };
}

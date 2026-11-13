import { useCallback, useEffect, useRef } from "react";
import { type AppError, publicError } from "../shared/errors.ts";

// Own only request cancellation and duplicate submission; feature states stay with their pages.
export function useTask(lifetime: AbortSignal) {
    const pending = useRef<AbortController | null>(null);
    useEffect(
        () => () => {
            pending.current?.abort();
        },
        [],
    );
    return useCallback(
        <T>(
            operation: (signal: AbortSignal) => Promise<T>,
            callbacks: {
                readonly started: () => void;
                readonly succeeded: (result: T) => void;
                readonly failed: (error: AppError) => void;
            },
        ) => {
            if (lifetime.aborted || pending.current) return;
            const request = new AbortController();
            pending.current = request;
            const signal = AbortSignal.any([lifetime, request.signal]);
            callbacks.started();
            void (async () => {
                try {
                    const result = await operation(signal);
                    if (!signal.aborted) callbacks.succeeded(result);
                } catch (cause) {
                    if (!signal.aborted) callbacks.failed(publicError(cause));
                } finally {
                    if (pending.current === request) pending.current = null;
                }
            })();
        },
        [lifetime],
    );
}

import { AppError } from "./errors.ts";

export async function withDeadline<T>(
    milliseconds: number,
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    if (signal.aborted) throw new AppError("cancelled", signal.reason);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), milliseconds);
    try {
        return await operation(AbortSignal.any([signal, timeout.signal]));
    } catch (cause) {
        if (signal.aborted) throw new AppError("cancelled", cause);
        if (timeout.signal.aborted) throw new AppError("timeout", cause);
        throw cause;
    } finally {
        clearTimeout(timer);
    }
}

export function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new AppError("cancelled", signal.reason));
    return new Promise((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(new AppError("cancelled", signal.reason));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, milliseconds);
        signal.addEventListener("abort", abort, { once: true });
    });
}

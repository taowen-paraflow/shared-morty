import { AppError } from "../../src/shared/errors.ts";

export function launcherClock() {
    const waiting = new Set<{ readonly milliseconds: number; readonly finish: () => void }>();
    let scheduled: (() => void) | undefined;
    return {
        now: Date.now,
        wait: (milliseconds: number, signal: AbortSignal) =>
            new Promise<void>((resolve, reject) => {
                if (signal.aborted) {
                    reject(new AppError("cancelled"));
                    return;
                }
                const abort = () => {
                    waiting.delete(entry);
                    reject(new AppError("cancelled"));
                };
                const entry = {
                    milliseconds,
                    finish: () => {
                        waiting.delete(entry);
                        signal.removeEventListener("abort", abort);
                        resolve();
                    },
                };
                signal.addEventListener("abort", abort, { once: true });
                waiting.add(entry);
                scheduled?.();
            }),
        tick: async (milliseconds: number) => {
            while (![...waiting].some((entry) => entry.milliseconds === milliseconds)) {
                await new Promise<void>((resolve) => {
                    scheduled = resolve;
                });
                scheduled = undefined;
            }
            for (const entry of [...waiting]) if (entry.milliseconds === milliseconds) entry.finish();
        },
    };
}

import { AppError } from "./errors.ts";

export interface UserIdentity {
    readonly id: string;
    readonly login: string;
}

export interface ActiveRun {
    readonly id: number;
    readonly status: string;
    readonly url: string;
}

export type RunnerState =
    | { readonly kind: "idle" }
    | { readonly kind: "active"; readonly run: ActiveRun }
    | { readonly kind: "conflict"; readonly runs: readonly [ActiveRun, ActiveRun, ...ActiveRun[]] };

export interface RunnerInspection {
    readonly user: UserIdentity;
    readonly runner: RunnerState;
}

export function repositoryName(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/u.test(normalized)) {
        throw new AppError("invalid_input");
    }
    const name = normalized.split("/")[1];
    if (name === "." || name === "..") throw new AppError("invalid_input");
    return normalized;
}

export function runnerState(runs: readonly ActiveRun[]): RunnerState {
    const [first, second, ...remaining] = runs;
    if (first === undefined) return { kind: "idle" };
    if (second === undefined) return { kind: "active", run: first };
    return { kind: "conflict", runs: [first, second, ...remaining] };
}

export function assertNever(value: never): never {
    throw new Error(`Unexpected state: ${String(value)}`);
}

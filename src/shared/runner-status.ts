import * as v from "valibot";
import { AppError } from "./errors.ts";

const identifier = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(Number.MAX_SAFE_INTEGER));
export const githubUserSchema = v.object({
    id: identifier,
    login: v.pipe(v.string(), v.minLength(1), v.maxLength(39), v.regex(/^[A-Za-z0-9-]+$/u)),
});
export const githubRunsSchema = v.object({
    total_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
    workflow_runs: v.pipe(
        v.array(
            v.object({
                id: identifier,
                display_title: v.pipe(v.string(), v.maxLength(512)),
                status: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
                path: v.pipe(v.string(), v.maxLength(512)),
                actor: v.nullable(v.object({ id: identifier })),
            }),
        ),
        v.maxLength(100),
    ),
});

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

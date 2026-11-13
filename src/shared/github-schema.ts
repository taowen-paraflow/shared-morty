import * as v from "valibot";

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
                conclusion: v.optional(v.nullable(v.string())),
                path: v.pipe(v.string(), v.maxLength(512)),
                actor: v.nullable(v.object({ id: identifier })),
            }),
        ),
        v.maxLength(100),
    ),
});

export const githubDefaultBranchSchema = v.object({
    default_branch: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
});

export const githubRepositorySchema = v.object({
    private: v.boolean(),
    full_name: v.string(),
    default_branch: v.string(),
});

export const githubExecutionRunSchema = v.object({
    run_attempt: v.optional(identifier),
    actor: v.object({ id: identifier }),
    event: v.string(),
    head_branch: v.string(),
    path: v.string(),
    display_title: v.string(),
});

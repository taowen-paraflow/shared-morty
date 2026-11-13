import { execFile } from "node:child_process";
import { withDeadline } from "../shared/async.ts";
import { AppError, type ErrorCode } from "../shared/errors.ts";

export interface Program {
    readonly command: string;
    readonly args: readonly string[];
}
export function executeProgram(
    program: Program,
    args: readonly string[],
    options: {
        readonly cwd: string;
        readonly env: Readonly<Record<string, string>>;
        readonly signal: AbortSignal;
        readonly timeout: number;
        readonly failure: ErrorCode;
    },
): Promise<string> {
    return withDeadline(
        options.timeout,
        options.signal,
        (signal) =>
            new Promise((resolve, reject) => {
                execFile(
                    program.command,
                    [...program.args, ...args],
                    {
                        cwd: options.cwd,
                        env: options.env,
                        signal,
                        maxBuffer: 2_000_000,
                    },
                    (error, stdout) => {
                        if (error) reject(new AppError(options.failure, error));
                        else resolve(stdout);
                    },
                );
            }),
    );
}

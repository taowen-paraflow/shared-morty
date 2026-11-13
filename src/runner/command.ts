import { publicError } from "../shared/errors.ts";

export async function runCommand(operation: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
    const lifetime = new AbortController();
    const cancel = () => lifetime.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
        const result = await operation(lifetime.signal);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (cause) {
        const error = publicError(cause);
        process.stderr.write(`${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`);
        process.exitCode = 1;
    } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
    }
}

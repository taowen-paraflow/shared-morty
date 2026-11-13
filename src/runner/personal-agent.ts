import * as v from "valibot";
import { chatReadySchema, mortyUrl } from "../shared/chat-protocol.ts";
import { AppError } from "../shared/errors.ts";
import { parseJson } from "../shared/login-protocol.ts";
import { executeProgram, type Program } from "./program.ts";

export interface AgentPrograms {
    readonly claude: Program;
    readonly morty: Program;
}
export const agentPrograms: AgentPrograms = {
    claude: { command: "claude", args: [] },
    morty: { command: "morty", args: [] },
};
export interface PersonalEnvironment {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
}
export async function startPersonalAgent(
    environment: PersonalEnvironment,
    programs: AgentPrograms,
    signal: AbortSignal,
) {
    const sessionId = crypto.randomUUID();
    const raw = await executeProgram(
        programs.claude,
        [
            "-p",
            "Reply with exactly: READY",
            "--output-format",
            "json",
            "--session-id",
            sessionId,
            "--max-turns",
            "1",
            "--tools",
            "",
            "--model",
            "sonnet",
        ],
        { ...environment, signal, timeout: 180_000, failure: "agent_failed" },
    );
    const result = v.safeParse(
        v.object({ type: v.literal("result"), is_error: v.literal(false), session_id: v.literal(sessionId) }),
        parseJson(raw.trim()),
    );
    if (!result.success) throw new AppError("agent_failed");
    return sessionId;
}
export async function connectPersonalMorty(
    environment: PersonalEnvironment,
    programs: AgentPrograms,
    sessionId: string,
    signal: AbortSignal,
) {
    const raw = await executeProgram(
        programs.morty,
        [
            "setup",
            "--base-url",
            "https://morty.build",
            "--cwd",
            environment.cwd,
            "--harness",
            "claude",
            "--session-id",
            sessionId,
            "--device-access",
            "1h",
        ],
        { ...environment, signal, timeout: 240_000, failure: "morty_unavailable" },
    );
    for (const line of raw.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        const ready = v.safeParse(
            v.object({ status: v.literal("ready"), ...chatReadySchema.entries }),
            parseJson(line),
        );
        if (ready.success) {
            const url = new URL(mortyUrl(ready.output.url));
            if (
                url.searchParams.get("sessionId") !== sessionId ||
                url.searchParams.get("workspace") !== environment.cwd
            )
                throw new AppError("invalid_response");
            return { url: url.href, accessExpiresAt: ready.output.accessExpiresAt };
        }
    }
    throw new AppError("morty_unavailable");
}
export async function stopPersonalMorty(
    environment: PersonalEnvironment,
    programs: AgentPrograms,
): Promise<void> {
    await executeProgram(programs.morty, ["stop"], {
        ...environment,
        signal: new AbortController().signal,
        timeout: 8_000,
        failure: "morty_unavailable",
    });
}

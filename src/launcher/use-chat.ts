import { useState } from "react";
import type { Session } from "./connection.ts";
import {
    beginPersonalChat,
    type PersonalChat,
    refreshPersonalChat,
    stopPersonalChat,
} from "./personal-chat.ts";
import { useTask } from "./use-task.ts";

type Settled = { readonly kind: "idle" } | PersonalChat;
type ChatState = Settled | { readonly kind: "working"; readonly previous: Settled };
export function useChat(session: Session, lifetime: AbortSignal) {
    const [state, setState] = useState<ChatState>({ kind: "idle" });
    const run = useTask(lifetime);
    const screen = state.kind === "working" ? state.previous : state;
    const execute = (operation: (signal: AbortSignal) => Promise<PersonalChat>) => {
        if (state.kind === "working") return;
        const previous = state;
        run(operation, {
            started: () => setState({ kind: "working", previous }),
            succeeded: setState,
            failed: (error) =>
                setState(
                    previous.kind === "waiting" || previous.kind === "ready" || previous.kind === "stopping"
                        ? previous.kind === "ready"
                            ? { kind: "waiting", context: previous.context, notice: error.message }
                            : { ...previous, notice: error.message }
                        : { kind: "failed", notice: error.message },
                ),
        });
    };
    return {
        screen,
        busy: state.kind === "working",
        ownsRunner:
            screen.kind === "waiting" ||
            screen.kind === "ready" ||
            screen.kind === "stopping" ||
            state.kind === "working",
        start: () => {
            if (screen.kind === "idle" || screen.kind === "failed" || screen.kind === "stopped")
                execute((signal) => beginPersonalChat(session.client, session.repository, signal));
        },
        refresh: () => {
            if (screen.kind !== "idle")
                execute((signal) => refreshPersonalChat(session.client, screen, signal));
        },
        stop: () => {
            if (screen.kind !== "idle") execute((signal) => stopPersonalChat(session.client, screen, signal));
        },
    };
}

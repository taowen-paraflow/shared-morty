import { useState } from "react";
import type { AppError } from "../shared/errors.ts";
import { assertNever } from "../shared/runner-status.ts";
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
function recoverChat(previous: Settled, error: AppError): Settled {
    switch (previous.kind) {
        case "ready":
            return { kind: "waiting", context: previous.context, notice: error.message };
        case "waiting":
        case "stopping":
            return { ...previous, notice: error.message };
        case "idle":
        case "failed":
        case "stopped":
            return { kind: "failed", notice: error.message };
        default:
            return assertNever(previous);
    }
}

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
            failed: (error) => setState(recoverChat(previous, error)),
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
        forceStop: () => {
            if (screen.kind === "stopping")
                execute((signal) => stopPersonalChat(session.client, screen, signal, "force"));
        },
        stop: () => {
            if (screen.kind !== "idle") execute((signal) => stopPersonalChat(session.client, screen, signal));
        },
    };
}

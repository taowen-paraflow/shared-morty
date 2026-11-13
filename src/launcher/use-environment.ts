import { useCallback, useEffect, useRef, useState } from "react";
import { wait } from "../shared/async.ts";
import { publicError } from "../shared/errors.ts";
import type { RunnerInspection } from "../shared/runner-status.ts";
import { forgetChat, recallChat } from "./browser-vault.ts";
import type { LauncherOptions, Session } from "./connection.ts";
import {
    beginPersonalChat,
    type PersonalChat,
    refreshPersonalChat,
    stopPersonalChat,
} from "./personal-chat.ts";

export type EnvironmentSnapshot =
    | { readonly kind: "available"; readonly inspection: RunnerInspection; readonly notice: string }
    | { readonly kind: "chat"; readonly chat: PersonalChat };
type Operation = "start" | "stop" | "force" | "check" | "cancel";
export type EnvironmentAction =
    | { readonly kind: Exclude<Operation, "cancel"> }
    | { readonly kind: "cancel"; readonly runId: number };
export type EnvironmentState =
    | EnvironmentSnapshot
    | { readonly kind: "loading" }
    | { readonly kind: "failed"; readonly notice: string }
    | { readonly kind: "syncing"; readonly previous: EnvironmentSnapshot }
    | { readonly kind: "working"; readonly previous: EnvironmentSnapshot; readonly operation: Operation }
    | { readonly kind: "offline"; readonly previous: EnvironmentSnapshot; readonly notice: string };

const defaultClock = { now: Date.now, wait };
export function useEnvironment(session: Session, lifetime: AbortSignal, options: LauncherOptions) {
    const [state, setState] = useState<EnvironmentState>({ kind: "loading" });
    const latest = useRef<EnvironmentState>(state);
    const pending = useRef<AbortController | null>(null);
    const clock = options.clock ?? defaultClock;
    const commit = useCallback((next: EnvironmentState) => {
        latest.current = next;
        setState(next);
    }, []);

    const sync = useCallback(
        async (snapshot: EnvironmentSnapshot, signal: AbortSignal): Promise<EnvironmentSnapshot> => {
            if (snapshot.kind === "chat") {
                const chat = await refreshPersonalChat(session.client, snapshot.chat, signal);
                if (chat.kind !== "failed" && chat.kind !== "stopped") return { kind: "chat", chat };
                await forgetChat(session.repository, session.user.id, signal);
                return {
                    kind: "available",
                    notice: chat.notice,
                    inspection: await session.client.inspectRunner(session.repository, signal),
                };
            }
            return {
                ...snapshot,
                inspection: await session.client.inspectRunner(session.repository, signal),
            };
        },
        [session],
    );

    const load = useCallback(
        async (signal: AbortSignal): Promise<EnvironmentSnapshot> => {
            const saved = await recallChat(session.repository, session.user.id, signal);
            if (!saved)
                return {
                    kind: "available",
                    notice: "",
                    inspection: await session.client.inspectRunner(session.repository, signal),
                };
            const context = {
                repository: saved.repository,
                issue: saved.issue,
                request: saved.request,
                key: saved.key,
            };
            const chat: PersonalChat =
                saved.phase === "stopping"
                    ? { kind: "stopping", context, notice: "正在确认环境停止结果。" }
                    : { kind: "waiting", context, stage: "queued", notice: "正在恢复个人环境。" };
            return sync({ kind: "chat", chat }, signal);
        },
        [session, sync],
    );

    const execute = useCallback(
        (
            previous: EnvironmentSnapshot | null,
            operation: (signal: AbortSignal) => Promise<EnvironmentSnapshot>,
            action?: Operation,
        ) => {
            if (lifetime.aborted) return;
            pending.current?.abort();
            const request = new AbortController();
            pending.current = request;
            const signal = AbortSignal.any([lifetime, request.signal]);
            if (previous)
                commit(
                    action ? { kind: "working", previous, operation: action } : { kind: "syncing", previous },
                );
            void (async () => {
                try {
                    const next = await operation(signal);
                    if (!signal.aborted) commit(next);
                } catch (cause) {
                    if (!signal.aborted)
                        commit(
                            previous
                                ? { kind: "offline", previous, notice: publicError(cause).message }
                                : { kind: "failed", notice: publicError(cause).message },
                        );
                } finally {
                    if (pending.current === request) pending.current = null;
                }
            })();
        },
        [commit, lifetime],
    );

    useEffect(
        () => () => {
            pending.current?.abort();
        },
        [],
    );
    useEffect(() => {
        if (state.kind === "loading") {
            if (!pending.current) execute(null, load);
            return;
        }
        if (state.kind === "working" || state.kind === "syncing") return;
        const controller = new AbortController();
        const signal = AbortSignal.any([lifetime, controller.signal]);
        const snapshot = state.kind === "offline" ? state.previous : state.kind === "failed" ? null : state;
        const milliseconds =
            state.kind === "offline" || state.kind === "failed"
                ? 15_000
                : snapshot?.kind === "chat" && snapshot.chat.kind !== "ready"
                  ? 5_000
                  : 30_000;
        void clock
            .wait(milliseconds, signal)
            .then(() => {
                if (!signal.aborted)
                    execute(snapshot, (nextSignal) =>
                        snapshot && state.kind !== "offline" ? sync(snapshot, nextSignal) : load(nextSignal),
                    );
            })
            .catch(() => {
                /* Cancellation releases the scheduled update. */
            });
        return () => controller.abort();
    }, [state, clock, execute, lifetime, load, sync]);

    const act = (action: EnvironmentAction) => {
        const current = latest.current;
        if (current.kind === "working" || current.kind === "loading" || current.kind === "failed") return;
        const previous =
            current.kind === "syncing" || current.kind === "offline" ? current.previous : current;
        execute(
            previous,
            async (signal) => {
                switch (action.kind) {
                    case "start":
                        return {
                            kind: "chat",
                            chat: await beginPersonalChat(session.client, session.repository, signal),
                        };
                    case "stop":
                    case "force": {
                        if (previous.kind !== "chat") return previous;
                        return {
                            kind: "chat",
                            chat: await stopPersonalChat(
                                session.client,
                                previous.chat,
                                signal,
                                action.kind === "force" || previous.chat.kind === "waiting"
                                    ? "force"
                                    : "graceful",
                            ),
                        };
                    }
                    case "check":
                        await session.client.checkEnvironment(session.repository, signal);
                        break;
                    case "cancel":
                        await session.client.cancelRunner(session.repository, action.runId, signal);
                        break;
                }
                return {
                    kind: "available",
                    notice:
                        action.kind === "check"
                            ? "检查任务已提交，状态会自动更新。"
                            : "停止请求已提交，状态会自动更新。",
                    inspection: await session.client.inspectRunner(session.repository, signal),
                };
            },
            action.kind,
        );
    };
    const retry = () => {
        const current = latest.current;
        if (current.kind === "working") return;
        const previous =
            current.kind === "offline" || current.kind === "syncing"
                ? current.previous
                : current.kind === "failed" || current.kind === "loading"
                  ? null
                  : current;
        execute(previous, (signal) =>
            previous && current.kind !== "offline" ? sync(previous, signal) : load(signal),
        );
    };
    return { state, act, retry, now: clock.now() };
}

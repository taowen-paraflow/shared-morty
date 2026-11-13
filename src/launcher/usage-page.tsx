import type { LauncherOptions, Session } from "./connection.ts";
import { EnvironmentPanel } from "./environment-panel.tsx";
import { useEnvironment } from "./use-environment.ts";

export function UsagePage({
    session,
    lifetime,
    hidden,
    options,
}: {
    readonly session: Session;
    readonly lifetime: AbortSignal;
    readonly hidden: boolean;
    readonly options: LauncherOptions;
}) {
    const environment = useEnvironment(session, lifetime, options);
    return (
        <section
            hidden={hidden}
            role="status"
            aria-live="polite"
            aria-busy={environment.state.kind === "loading" || environment.state.kind === "working"}
        >
            <h2>个人 Claude 环境</h2>
            <EnvironmentPanel
                state={environment.state}
                act={environment.act}
                retry={environment.retry}
                repository={session.repository}
                now={environment.now}
            />
        </section>
    );
}

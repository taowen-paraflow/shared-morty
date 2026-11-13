import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { LauncherOptions } from "./connection.ts";
import { Launcher } from "./view.tsx";

export function mountLauncher(root: HTMLElement, options: LauncherOptions = {}): () => void {
    const lifetime = new AbortController();
    const view = createRoot(root);
    flushSync(() => view.render(<Launcher options={options} lifetime={lifetime.signal} />));
    return () => {
        lifetime.abort();
        view.unmount();
    };
}

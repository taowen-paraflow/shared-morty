import { queryByRole } from "@testing-library/dom";

export function visibleStatus(root: HTMLElement, content: string): Promise<void> {
    const settled = () => {
        const status = queryByRole(root, "status");
        return status?.textContent?.includes(content) && status.getAttribute("aria-busy") !== "true";
    };
    if (settled()) return Promise.resolve();
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (settled()) {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(root, { childList: true, subtree: true, attributes: true });
    });
}

// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, queryByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.ts";
import { githubServer } from "./support/github-server.ts";

test("Given Alice has a pending runner, when she connects GitHub, then the launcher shows her existing environment", async () => {
    const github = await githubServer();
    github.setRuns([{ id: 201, actorId: 42, name: "shared-morty-42-r-own", status: "pending" }]);
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    let observer: MutationObserver | undefined;
    try {
        const connected = new Promise<HTMLElement>((resolve) => {
            observer = new MutationObserver(() => {
                const link = queryByRole(root, "link", { name: "查看我的 runner" });
                if (link) {
                    observer?.disconnect();
                    resolve(link);
                }
            });
            observer.observe(root, { childList: true, subtree: true });
        });
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        const link = await connected;
        expect(link.getAttribute("href")).toBe("https://github.com/team/execution/actions/runs/201");
        expect(root.textContent).toContain("alice");
        expect(root.textContent).toContain("等待运行");
        expect(root.textContent).not.toContain("fixture-token");
        expect(getByLabelText(root, "GitHub Token")).toHaveProperty("value", "");
    } finally {
        observer?.disconnect();
        unmount();
        root.remove();
        await github.close();
    }
});

// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, getByText, queryByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { githubServer } from "./support/github-server.ts";
import { visibleStatus } from "./support/launcher-ui.ts";

test("Given a first-time visitor, when she opens the launcher, then the token guide pre-fills the execution owner and minimum permissions", () => {
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root);
    try {
        expect(getByLabelText(root, "执行仓库")).toHaveProperty("value", "taowen-paraflow/shared-morty");
        const href = getByRole(root, "link", { name: "在 GitHub 创建 Token" }).getAttribute("href");
        if (!href) throw new Error("Missing token template");
        const url = new URL(href);
        expect(url.origin + url.pathname).toBe("https://github.com/settings/personal-access-tokens/new");
        expect(url.searchParams.get("target_name")).toBe("taowen-paraflow");
        expect(url.searchParams.get("expires_in")).toBe("90");
        expect(url.searchParams.get("actions")).toBe("write");
        expect(url.searchParams.get("issues")).toBe("write");
        expect(url.searchParams.has("secrets")).toBe(false);
        expect(getByText(root, /Only select repositories/)).toBeDefined();
        expect(getByText(root, /刷新页面后需重新连接/)).toBeDefined();
    } finally {
        unmount();
        root.remove();
    }
});

test("Given another execution repository, when a visitor edits its name, then both token templates target that repository and invalid names cannot generate a link", async () => {
    const github = await githubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        const template = getByRole(root, "link", { name: "在 GitHub 创建 Token" });
        expect(template.getAttribute("href")).toContain("target_name=team");
        fireEvent.click(getByText(root, "我要共享自己的账号"));
        const shared = getByRole(root, "link", { name: "创建可共享账号的 Token" }).getAttribute("href");
        if (!shared) throw new Error("Missing sharing template");
        expect(new URL(shared).searchParams.get("secrets")).toBe("write");
        expect(new URL(shared).searchParams.get("target_name")).toBe("team");
        fireEvent.input(getByLabelText(root, "执行仓库"), {
            target: { value: "https://attacker.example/x" },
        });
        expect(queryByRole(root, "link", { name: "在 GitHub 创建 Token" })).toBeNull();
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "当前没有运行中的 runner");
        expect(getByLabelText(root, "GitHub Token")).toHaveProperty("value", "");
        expect(root.textContent).not.toContain("fixture-token");
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

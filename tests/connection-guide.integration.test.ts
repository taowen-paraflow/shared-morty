// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole, getByText, queryByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { githubServer } from "./support/github-server.ts";
import { visibleStatus } from "./support/launcher-ui.ts";

test("Given a collaborator on another personal account's repository, when she opens the launcher, then token creation does not require that account as a resource owner", () => {
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root);
    try {
        expect(getByLabelText(root, "执行仓库")).toHaveProperty("value", "taowen-paraflow/shared-morty");
        const href = getByRole(root, "link", { name: "创建协作者 Token（classic）" }).getAttribute("href");
        if (!href) throw new Error("Missing token template");
        const url = new URL(href);
        expect(url.origin + url.pathname).toBe("https://github.com/settings/tokens/new");
        expect(url.searchParams.has("target_name")).toBe(false);
        expect(url.searchParams.get("scopes")).toBe("repo");
        expect(getByText(root, /不能限定到单个仓库/)).toBeDefined();
        fireEvent.click(getByText(root, "我是仓库所有者或组织内部成员"));
        const fineGrained = getByRole(root, "link", { name: "创建 fine-grained Token" }).getAttribute("href");
        if (!fineGrained) throw new Error("Missing owner token template");
        const ownerUrl = new URL(fineGrained);
        expect(ownerUrl.searchParams.get("target_name")).toBe("taowen-paraflow");
        expect(ownerUrl.searchParams.get("expires_in")).toBe("90");
        expect(ownerUrl.searchParams.get("actions")).toBe("write");
        expect(ownerUrl.searchParams.get("issues")).toBe("write");
        expect(ownerUrl.searchParams.has("secrets")).toBe(false);
        expect(getByText(root, /Only select repositories/)).toBeDefined();
        expect(getByText(root, /刷新可自动恢复/)).toBeDefined();
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
        const template = getByRole(root, "link", { name: "创建协作者 Token（classic）" });
        expect(template.getAttribute("href")).not.toContain("target_name=");
        fireEvent.click(getByText(root, "我是仓库所有者或组织内部成员"));
        expect(getByRole(root, "link", { name: "创建 fine-grained Token" }).getAttribute("href")).toContain(
            "target_name=team",
        );
        fireEvent.click(getByText(root, "我要共享自己的账号"));
        const shared = getByRole(root, "link", { name: "创建可共享账号的 Token" }).getAttribute("href");
        if (!shared) throw new Error("Missing sharing template");
        expect(new URL(shared).searchParams.get("secrets")).toBe("write");
        expect(new URL(shared).searchParams.get("target_name")).toBe("team");
        fireEvent.input(getByLabelText(root, "执行仓库"), {
            target: { value: "https://attacker.example/x" },
        });
        expect(queryByRole(root, "link", { name: "创建协作者 Token（classic）" })).toBeNull();
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

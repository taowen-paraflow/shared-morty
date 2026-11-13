// @vitest-environment happy-dom
import { fireEvent, getByLabelText, getByRole } from "@testing-library/dom";
import { expect, test } from "vitest";
import { mountLauncher } from "../src/launcher/app.tsx";
import { githubServer } from "./support/github-server.ts";
import { visibleStatus } from "./support/launcher-ui.ts";

test("Given a connected team member, when she chooses team Claude, then a personal chat launch is available without provider authorization", async () => {
    const github = await githubServer();
    const root = document.createElement("main");
    document.body.append(root);
    const unmount = mountLauncher(root, { apiOrigin: github.origin });
    try {
        fireEvent.input(getByLabelText(root, "执行仓库"), { target: { value: "team/execution" } });
        fireEvent.input(getByLabelText(root, "GitHub Token"), { target: { value: "fixture-token" } });
        fireEvent.click(getByRole(root, "button", { name: "连接 GitHub" }));
        await visibleStatus(root, "当前没有运行中的 runner");
        expect(getByRole(root, "button", { name: "开始聊天" })).toBeDefined();
    } finally {
        unmount();
        root.remove();
        await github.close();
    }
});

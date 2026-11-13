import { type SubmitEvent, useRef, useState } from "react";
import { defaultRepository } from "./config.ts";
import type { ConnectionInput } from "./connection.ts";
import { tokenGuide } from "./token-guide.ts";

export function ConnectionForm({ onConnect }: { readonly onConnect: (input: ConnectionInput) => void }) {
    const [repository, setRepository] = useState(defaultRepository);
    const token = useRef<HTMLInputElement>(null);
    const guide = tokenGuide(repository);
    const submit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!token.current) return;
        const input = { repository, token: token.current.value };
        token.current.value = "";
        onConnect(input);
    };
    return (
        <form className="connection-form" onSubmit={submit}>
            <p>首次连接只需创建一个 GitHub Token。已有 Token 可以直接粘贴到第 3 步。</p>
            <a href="#github-token">已有 Token？直接连接</a>
            <ol className="connection-steps">
                <li>
                    <h2>确认执行仓库</h2>
                    <p>这里运行你的个人环境。使用团队给你的仓库，通常无需修改。</p>
                    <label>
                        执行仓库
                        <input
                            name="repository"
                            value={repository}
                            onInput={(event) => setRepository(event.currentTarget.value)}
                            placeholder="owner/repository"
                            autoComplete="off"
                            required
                        />
                    </label>
                </li>
                <li>
                    <h2>创建 GitHub Token</h2>
                    {guide.kind === "ready" ? (
                        <>
                            <a
                                className="button-link"
                                href={guide.useUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                在 GitHub 创建 Token
                            </a>
                            <p>
                                新页面已预填 Resource owner：<strong>{guide.owner}</strong>，以及
                                Actions、Issues 的 Read and write 权限。
                            </p>
                            <p>
                                在 Repository access 选择 <strong>Only select repositories</strong>，再勾选{" "}
                                <strong>{guide.name}</strong>。保留所需权限，点击 Generate token。
                            </p>
                            <details className="sharing-token-guide">
                                <summary>我要共享自己的账号</summary>
                                <p>
                                    共享自己的 Claude 账号还需要 Secrets 的 Read and write
                                    权限；仅使用团队账号不需要。
                                </p>
                                <a href={guide.shareUrl} target="_blank" rel="noopener noreferrer">
                                    创建可共享账号的 Token
                                </a>
                            </details>
                        </>
                    ) : (
                        <p>请先按 owner/repository 格式填写执行仓库，再创建 Token。</p>
                    )}
                    <details className="connection-help">
                        <summary>找不到仓库或连接失败？</summary>
                        <p>
                            确认 Resource owner
                            是仓库所属的用户或组织，并且你有该仓库的写入权限。组织未出现在列表时，请管理员确认你的成员身份和组织的
                            Token 策略。
                        </p>
                        <p>
                            如果 Token 显示 Pending，需要管理员批准后才能运行任务。Token
                            失效或过期时，重新创建并粘贴完整的新 Token。
                        </p>
                        <a
                            href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            查看 GitHub 官方 Token 说明
                        </a>
                    </details>
                </li>
                <li>
                    <h2>粘贴 Token 并连接</h2>
                    <p>
                        复制 GitHub 刚生成的完整 Token，回到这里粘贴。这里填的是 GitHub Token，Claude
                        账号无需重复登录。
                    </p>
                    <label>
                        GitHub Token
                        <input
                            id="github-token"
                            ref={token}
                            name="token"
                            type="password"
                            autoComplete="off"
                            required
                        />
                    </label>
                    <p className="hint">
                        连接后，Token
                        加密保存在此浏览器，刷新可自动恢复。请使用自己的浏览器；清除此网站数据会移除连接和环境恢复密钥。
                    </p>
                    <button type="submit" disabled={guide.kind === "invalid"}>
                        连接 GitHub
                    </button>
                </li>
            </ol>
        </form>
    );
}

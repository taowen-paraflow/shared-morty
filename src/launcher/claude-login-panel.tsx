import { type SubmitEvent, useRef } from "react";
import { assertNever } from "../shared/runner-status.ts";
import type { ClaudeLoginState } from "./claude-login.ts";
import type { ClaudeActions } from "./claude-sharing-page.tsx";

function AuthorizationForm({
    busy,
    onCode,
}: {
    readonly busy: boolean;
    readonly onCode: (code: string) => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    const submit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy || !input.current) return;
        const code = input.current.value;
        input.current.value = "";
        onCode(code);
    };
    return (
        <form onSubmit={submit}>
            <label>
                Claude 授权码
                <input ref={input} type="password" autoComplete="off" readOnly={busy} required />
            </label>
            <button type="submit" disabled={busy}>
                提交授权码
            </button>
        </form>
    );
}

interface LoginPanelProps {
    readonly login: ClaudeLoginState;
    readonly busy: boolean;
    readonly actions: ClaudeActions;
}

function LoginStep({ login, busy, actions }: LoginPanelProps) {
    switch (login.kind) {
        case "waiting":
            return (
                <>
                    <p>等待登录任务。稍后点击刷新登录状态，请保持本页打开。</p>
                    <button type="button" disabled={busy} onClick={actions.refresh}>
                        刷新登录状态
                    </button>
                </>
            );
        case "authorizing":
            return (
                <>
                    <p>在官方页面登录，完成后将授权码粘贴到这里。请保持本页打开。</p>
                    <a href={login.challenge.url} target="_blank" rel="noopener noreferrer">
                        打开 Claude 官方授权页面
                    </a>
                    <AuthorizationForm busy={busy} onCode={actions.submitCode} />
                </>
            );
        case "waiting_token":
            return (
                <>
                    <p>已发送授权码，等待 Claude 完成授权。</p>
                    <button type="button" disabled={busy} onClick={actions.refresh}>
                        刷新登录状态
                    </button>
                </>
            );
        case "authorized":
            return (
                <>
                    <p>已登录，尚未共享。共享后，仓库运行成员可使用此 Claude 账号。</p>
                    <p>共享将写入或替换此仓库已有的 Claude 凭据。</p>
                    <button type="button" disabled={busy} onClick={actions.publish}>
                        共享到此仓库
                    </button>
                </>
            );
        case "shared":
            return (
                <>
                    <p>团队 Claude 已共享。</p>
                    <button type="button" disabled={busy} onClick={actions.reset}>
                        返回共享设置
                    </button>
                </>
            );
        case "failed":
            return (
                <button type="button" disabled={busy} onClick={actions.reset}>
                    返回共享设置
                </button>
            );
        default:
            return assertNever(login);
    }
}

export function ClaudeLoginPanel(props: LoginPanelProps) {
    const { login, busy, actions } = props;
    return (
        <>
            {login.kind !== "shared" && login.notice && <p>{login.notice}</p>}
            {login.kind !== "shared" && login.kind !== "failed" && (
                <button type="button" disabled={busy} onClick={actions.cancel}>
                    取消登录
                </button>
            )}
            <LoginStep {...props} />
        </>
    );
}

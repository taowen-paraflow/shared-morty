import { type SubmitEvent, useRef } from "react";
import type { ConnectionInput } from "./connection.ts";

export function ConnectionForm({ onConnect }: { readonly onConnect: (input: ConnectionInput) => void }) {
    const repository = useRef<HTMLInputElement>(null);
    const token = useRef<HTMLInputElement>(null);
    const submit = (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!repository.current || !token.current) return;
        const input = { repository: repository.current.value, token: token.current.value };
        token.current.value = "";
        onConnect(input);
    };
    return (
        <form onSubmit={submit}>
            <label>
                执行仓库
                <input
                    ref={repository}
                    name="repository"
                    placeholder="owner/repository"
                    autoComplete="off"
                    required
                />
            </label>
            <label>
                GitHub Token
                <input ref={token} name="token" type="password" autoComplete="off" required />
            </label>
            <p className="hint">Token 仅用于本次页面连接。</p>
            <button type="submit">连接 GitHub</button>
        </form>
    );
}

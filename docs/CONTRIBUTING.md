---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# Contributing

Use Node 24.22.1 and Corepack with the pnpm version pinned in `package.json`.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

The development server is local tooling for the static launcher, not a production backend. It binds to loopback and needs no production credentials to start.

The launcher connects a GitHub user, inspects personal runners, dispatches an execution-environment check, refreshes status, and requests cancellation of owned tasks. The CLI exposes inspection:

```sh
corepack pnpm runner status --repository owner/repository
```

The CLI reads its token from `GH_TOKEN`; never place it in an argument. The browser guides first-time users through confirming a prefilled repository, opening the supported token template, and pasting the generated token. Repository collaborators use their own classic token with repo scope; this scope covers all accessible public/private repositories and cannot be limited to this repository. Owners and organization members may instead expand the fine-grained route and select only the execution repository. Fine-grained tokens do not support repository/outside collaborators. Existing tokens can skip to the password field. The fine-grained member template requests Actions/Issues write; its separate sharing template adds Secrets write. A token never grants privileges beyond the actual user’s repository role. Organization membership/approval and expiry troubleshooting remain visible in the guide. The browser encrypts the verified GitHub connection in same-origin IndexedDB and reauthenticates it after reload. Fine-grained tokens need repository metadata and Actions read/write permissions for control operations. The check dispatches `runner.yml` on the repository's default branch, shares the per-user concurrency group, validates the GitHub run against the Actions context, and exits after reporting secret presence. Public and private execution repositories are supported. The check is diagnostic, not a chat environment. Personal Claude/Morty chat is launched separately through `chat.yml`; Claude login/sharing uses `login.yml`. History persistence remains a later slice.

To try Claude login, use a trusted public or private execution repository with the source and product workflows, enable Issues, and use its default branch. The owner token needs Actions and Issues read/write plus Secrets read/write permissions. Choose “共享 Claude Code”, click “开始 Claude 授权”, keep the page open, refresh login status, complete the official authorization, submit its code, refresh again, then click “共享到此仓库”. Publishing replaces `SHARED_CLAUDE_TOKEN`. No personal history is loaded during login. The pinned CLI is `@anthropic-ai/claude-code@2.1.323`; the worker uses Ubuntu's `script` PTY and an isolated temporary home with an explicit environment allowlist.

The login request expires after 15 minutes including Actions queue time. Browser private keys and the unshared token remain in page memory; reloading loses them. If a dispatch/code response is uncertain, refresh rather than resubmitting. A failed Secret write retains the token for an explicit retry. “取消登录” cancels only the verified matching login task, or discards an already returned token. Closing the page does not automatically cancel the workflow.

Cancellation uses GitHub's normal cancellation endpoint and does not save personal data. Acceptance of cancellation or dispatch does not establish completion; refresh to inspect the run. A failed dispatch response may be ambiguous: refresh before retrying. GitHub concurrency prevents two running jobs for one actor; pending tasks may be replaced by GitHub, and there is no fairness guarantee.

The launcher has two independent destinations: team usage and Claude account sharing. `connection.ts` owns GitHub connection; `view.tsx` owns navigation. `use-environment.ts` owns a single personal-environment lifecycle, serial polling and commands; `usage-page.tsx` passes its state and events to `EnvironmentPanel`. Diagnostics remain collapsed in run details. `claude-sharing-page.tsx` owns authorization/publishing. Panels declare their callback contracts instead of importing types from parent pages.

Pages invoke typed domain operations; HTTP decoding, authorization, encryption, and protocol rules remain in domain modules. Chat refresh decodes verified messages into one readonly outcome union, preserving failure over stop over ready. There is no global action union combining unrelated features.

Runner entrypoints share `issue-execution.ts` for Actions event decoding and the neutral `IssueExecution` contract. Parsing does not grant authority: each domain flow still verifies the actual GitHub execution before starting processes. The chat worker keeps stop polling separate from startup and process cleanup.

Feature lifecycle states are readonly unions. `useTask` only handles cancellation and synchronous duplicate submission protection; it does not own product transitions. Usage and Claude sharing stay mounted but hidden across navigation so their independent exchange keys and results survive; reconnection and page destruction discard sharing exchanges. Personal chat checkpoints survive in the browser vault; reloading reauthenticates the user and decrypts verified remote messages again. Chat refresh rechecks the actual run before showing its private link. Each page has its own pending state, while the execution boundary and Actions concurrency still enforce one runner per actor across features. Secret inputs are uncontrolled refs, cleared on submission, and are not copied into React state.

Before changing behavior, read [Engineering rules](../AGENTS.md), write a failing acceptance scenario, and use [Testing](TESTING.md). Before committing, follow [Code review](CODE_REVIEW.md). Keep Markdown edits in a separate commit from implementation.

Set `SHARED_MORTY_DIAGNOSTICS=1` to record typed login stages, GitHub resource/status pairs, terminal byte counts, and allowlisted prompt markers. No headers, response bodies, terminal text, authorization URLs/codes, or tokens are recorded. The login workflow currently enables these diagnostics for live verification. The temporary `experiments/live-launcher.mjs` serves the built launcher on loopback for at most 30 minutes and reads the local GitHub CLI session once into page memory; it is manual research tooling, not a production control service.

## Running personal Claude chat

Use “使用团队账号” → “开始聊天” → automatic progress → “打开聊天”. Startup/stopping polls every 5 seconds, ready/idle every 30 seconds, and transient failures every 15 seconds, serially and with cancellation. No manual refresh is needed. The member needs Actions and Issues read/write, not Secrets permissions or provider OAuth. The runner uses pinned Claude 2.1.323 and Morty 0.4.253, creates an isolated temporary home/workspace/computer, and delivers the private handoff through encrypted Issue messages. It never sends the shared token to the launcher. Each launch starts fresh; no personal archive or cache is written.

“结束环境” → “确认结束” posts an owner-authenticated control instruction bound to this run/attempt. The worker polls at most every 30 seconds, stops Morty, publishes an encrypted outcome, closes the Issue and deletes its temporary root. The launcher automatically confirms completion. “运行详情” → “强制结束环境” is a fallback; GitHub termination may skip cleanup, so do not claim Issue closure or saved history. All launch/login/check jobs share the actor-id concurrency group.

To publish the static launcher, a repository administrator must select Settings → Pages → Source: GitHub Actions. Run “Deploy launcher” from the default branch after code changes; deployment builds and checks the same head before uploading `dist/launcher`. Set `defaultRepository` in `src/launcher/config.ts` to the execution repository when deploying a fork. The guide derives validated GitHub template URLs from this editable public value; it does not grant repository access or embed credentials. `pages.yml` is manual so repositories without Pages configured do not fail on every code push.


Token templates use GitHub’s documented `target_name`, `expires_in`, and permission query parameters. Repository selection still happens in GitHub; the launcher does not claim to preselect it. See [GitHub’s template parameters](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters). Connection credentials are encrypted in the same-origin browser vault.

The native browser vault stores encrypted connection data and nonextractable CryptoKeys, with per-repository/user chat checkpoints written before dispatch and stop submission. Ready URLs and chat content are not persisted. Clearing site data loses recovery; existing v1 Issue protocols remain unchanged, and old sessions without a saved key cannot be recovered. This is same-origin browser storage, not a server database or history archive. Nonextractability does not protect against malicious same-origin code. See `state.md` for exact records and ownership.

Token 引导修正：GitHub 官方当前不支持 repository / outside collaborator 使用 fine-grained Token。个人账号 taowen-paraflow 的仓库协作者 taowen 应用本人的 classic Token；不能将 taowen-paraflow 强行作为其 fine-grained Resource owner，也不共享所有者的 GitHub Token。taowen 的写权限已由真实 API 确认；真实聊天 run 43376282942 的 actor 也是 taowen。该证据来自现有 classic 凭据，不代表已经验证新 Token 的签发。引导测试只验证链接和可见说明，不模拟 GitHub 发证策略。[Token 限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)；[dispatch 的 classic repo scope 要求](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。

The launcher build adds SHA-256 content versions to script and stylesheet URLs. A live browser retained the previous unversioned script after a successful deployment while a direct HTTP read already matched the new build; resource versions prevent this script-cache reuse once the new HTML is loaded. Already cached HTML may require a reload or a versioned page URL. No browser data needs to be cleared.

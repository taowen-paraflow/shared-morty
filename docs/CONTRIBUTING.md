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

The CLI reads its token from `GH_TOKEN`; never place it in an argument. The browser guides first-time users through confirming a prefilled repository, opening GitHub’s fine-grained token template, selecting only that repository, and pasting the generated token. Existing tokens can skip to the password field. The member template requests Actions/Issues write; the separate sharing template adds Secrets write. Organization membership/approval and expiry troubleshooting remain visible in the guide. The browser accepts a token for the current page session. Fine-grained tokens need repository metadata and Actions read/write permissions for control operations. The check dispatches `runner.yml` on the repository's default branch, shares the per-user concurrency group, validates the GitHub run against the Actions context, and exits after reporting secret presence. Public and private execution repositories are supported. The check is diagnostic, not a chat environment. Personal Claude/Morty chat is launched separately through `chat.yml`; Claude login/sharing uses `login.yml`. Codex authentication, persistent browser vaults, and history persistence remain later slices.

To try Claude login, use a trusted public or private execution repository with the source and product workflows, enable Issues, and use its default branch. The owner token needs Actions and Issues read/write plus Secrets read/write permissions. Choose “共享 Claude Code”, click “开始 Claude 授权”, keep the page open, refresh login status, complete the official authorization, submit its code, refresh again, then click “共享到此仓库”. Publishing replaces `SHARED_CLAUDE_TOKEN`. No personal history is loaded during login. The pinned CLI is `@anthropic-ai/claude-code@2.1.323`; the worker uses Ubuntu's `script` PTY and an isolated temporary home with an explicit environment allowlist.

The login request expires after 15 minutes including Actions queue time. Browser private keys and the unshared token remain in page memory; reloading loses them. If a dispatch/code response is uncertain, refresh rather than resubmitting. A failed Secret write retains the token for an explicit retry. “取消登录” cancels only the verified matching login task, or discards an already returned token. Closing the page does not automatically cancel the workflow.

Cancellation uses GitHub's normal cancellation endpoint and does not save personal data. Acceptance of cancellation or dispatch does not establish completion; refresh to inspect the run. A failed dispatch response may be ambiguous: refresh before retrying. GitHub concurrency prevents two running jobs for one actor; pending tasks may be replaced by GitHub, and there is no fairness guarantee.

The launcher has three independent destinations: team usage, Claude account sharing, and Codex account sharing (currently an explicit unimplemented screen). `connection.ts` owns GitHub connection; `view.tsx` owns navigation. `use-runner.ts` owns runner inspection/control, while `usage-page.tsx` renders it and coordinates visibility with chat. `claude-sharing-page.tsx` owns authorization/publishing. Panels declare their callback contracts instead of importing types from parent pages.

Pages invoke typed domain operations; HTTP decoding, authorization, encryption, and protocol rules remain in domain modules. Chat refresh decodes verified messages into one readonly outcome union, preserving failure over stop over ready. There is no global action union combining unrelated features.

Runner entrypoints share `issue-execution.ts` for Actions event decoding and the neutral `IssueExecution` contract. Parsing does not grant authority: each domain flow still verifies the actual GitHub execution before starting processes. The chat worker keeps stop polling separate from startup and process cleanup.

Feature lifecycle states are readonly unions. `useTask` only handles cancellation and synchronous duplicate submission protection; it does not own product transitions. Usage and Claude sharing stay mounted but hidden across navigation so their independent exchange keys and results survive; reconnection and page destruction discard them. Without an active chat context, returning to usage refreshes its task inspection. Chat refresh rechecks the actual run before showing its private link. Each page has its own pending state, while the execution boundary and Actions concurrency still enforce one runner per actor across features. Secret inputs are uncontrolled refs, cleared on submission, and are not copied into React state.

Before changing behavior, read [Engineering rules](../AGENTS.md), write a failing acceptance scenario, and use [Testing](TESTING.md). Before committing, follow [Code review](CODE_REVIEW.md). Keep Markdown edits in a separate commit from implementation.

Set `SHARED_MORTY_DIAGNOSTICS=1` to record typed login stages, GitHub resource/status pairs, terminal byte counts, and allowlisted prompt markers. No headers, response bodies, terminal text, authorization URLs/codes, or tokens are recorded. The login workflow currently enables these diagnostics for live verification. The temporary `experiments/live-launcher.mjs` serves the built launcher on loopback for at most 30 minutes and reads the local GitHub CLI session once into page memory; it is manual research tooling, not a production control service.

## Running personal Claude chat

Use “使用团队账号” → “启动我的 Claude 聊天” → “刷新聊天状态” → “打开我的 Morty 聊天”. The member needs Actions and Issues read/write, not Secrets permissions or provider OAuth. The runner uses pinned Claude 2.1.323 and Morty 0.4.253, creates an isolated temporary home/workspace/computer, and delivers the private handoff through encrypted Issue messages. It never sends the shared token to the launcher. Each launch starts fresh; no personal archive or cache is written.

“停止我的聊天（不保存）” posts an owner-authenticated control instruction bound to this run/attempt. The worker polls at most every 30 seconds, stops Morty, publishes an encrypted outcome, closes the Issue and deletes its temporary root. Refresh to confirm. “强制停止 runner（不保存）” is a fallback; GitHub termination may skip cleanup, so do not claim Issue closure or saved history. All launch/login/check jobs share the actor-id concurrency group.

To publish the static launcher, a repository administrator must select Settings → Pages → Source: GitHub Actions. Run “Deploy launcher” from the default branch after code changes; deployment builds and checks the same head before uploading `dist/launcher`. Set `defaultRepository` in `src/launcher/config.ts` to the execution repository when deploying a fork. The guide derives validated GitHub template URLs from this editable public value; it does not grant repository access or embed credentials. `pages.yml` is manual so repositories without Pages configured do not fail on every code push.


Token templates use GitHub’s documented `target_name`, `expires_in`, and permission query parameters. Repository selection still happens in GitHub; the launcher does not claim to preselect it. See [GitHub’s template parameters](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters). Token storage remains memory-only.

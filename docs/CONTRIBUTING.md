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

The CLI reads its token from `GH_TOKEN`; never place it in an argument. The browser accepts a token for the current page session. Fine-grained tokens need repository metadata and Actions read/write permissions for control operations. The check dispatches `runner.yml` on the repository's default branch, shares the per-user concurrency group, validates the GitHub run against the Actions context, and exits after reporting secret presence. It refuses public execution repositories. This is preparation for chat, not a chat environment. Claude login/sharing is implemented separately through `login.yml`; persistent browser vaults, Morty, Codex authentication, and history persistence remain later slices.

To try Claude login, copy the source and both product workflows to a trusted private execution repository, enable Issues, and use its default branch. The owner token needs Actions and Issues read/write plus Secrets read/write permissions. Click “登录并共享 Claude”, keep the page open, refresh login status, complete the official authorization, submit its code, refresh again, then click “共享到此仓库”. Publishing replaces `SHARED_CLAUDE_TOKEN`. No personal history is loaded during login. The pinned CLI is `@anthropic-ai/claude-code@2.1.323`; the worker uses Ubuntu's `script` PTY and an isolated temporary home with an explicit environment allowlist.

The login request expires after 15 minutes including Actions queue time. Browser private keys and the unshared token remain in page memory; reloading loses them. If a dispatch/code response is uncertain, refresh rather than resubmitting. A failed Secret write retains the token for an explicit retry. “取消登录” cancels only the verified matching login task, or discards an already returned token. Closing the page does not automatically cancel the workflow.

Cancellation uses GitHub's normal cancellation endpoint and does not save personal data. Acceptance of cancellation or dispatch does not establish completion; refresh to inspect the run. A failed dispatch response may be ambiguous: refresh before retrying. GitHub concurrency prevents two running jobs for one actor; pending tasks may be replaced by GitHub, and there is no fairness guarantee.

The launcher uses React JSX components and a single page reducer. Components describe markup and emit actions; `operations.ts` admits actions for the current phase and invokes the existing domain flows. `useLauncher` owns request cancellation and operation IDs; the reducer ignores results from older operations. Keep network/encryption work out of components and derive pending UI from the state union rather than maintaining parallel loading flags. Secret inputs are uncontrolled refs, cleared on submission, and are not copied into React state.

Before changing behavior, read [Engineering rules](../AGENTS.md), write a failing acceptance scenario, and use [Testing](TESTING.md). Before committing, follow [Code review](CODE_REVIEW.md). Keep Markdown edits in a separate commit from implementation.

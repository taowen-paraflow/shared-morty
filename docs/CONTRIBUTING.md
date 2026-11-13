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

The CLI reads its token from `GH_TOKEN`; never place it in an argument. The browser accepts a token for the current page session. Fine-grained tokens need repository metadata and Actions read/write permissions for control operations. The check dispatches `runner.yml` on the repository's default branch, shares the per-user concurrency group, validates the GitHub run against the Actions context, and exits after reporting secret presence. It refuses public execution repositories. This is preparation for chat, not a chat environment. Persistent browser vaults, OAuth sharing, Morty, and history persistence remain later slices.

Cancellation uses GitHub's normal cancellation endpoint and does not save personal data. Acceptance of cancellation or dispatch does not establish completion; refresh to inspect the run. A failed dispatch response may be ambiguous: refresh before retrying. GitHub concurrency prevents two running jobs for one actor; pending tasks may be replaced by GitHub, and there is no fairness guarantee.

Before changing behavior, read [Engineering rules](../AGENTS.md), write a failing acceptance scenario, and use [Testing](TESTING.md). Before committing, follow [Code review](CODE_REVIEW.md). Keep Markdown edits in a separate commit from implementation.

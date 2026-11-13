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

The first product slice connects a GitHub user and shows only that user's shared-morty runner state. The CLI exposes the same inspection behavior:

```sh
corepack pnpm runner status --repository owner/repository
```

The CLI reads its token from `GH_TOKEN`; never place it in an argument. The browser accepts a token for the current page session. Persistent browser vaults, dispatch, OAuth sharing, and history persistence remain later slices; the initial application does not claim those capabilities.

Before changing behavior, read [Engineering rules](../AGENTS.md), write a failing acceptance scenario, and use [Testing](TESTING.md). Before committing, follow [Code review](CODE_REVIEW.md). Keep Markdown edits in a separate commit from implementation.

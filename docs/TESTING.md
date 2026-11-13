---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# Testing

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Use focused suites while developing; the combined CI check runs the complete current acceptance set.

Web integration tests render the complete launcher and interact using labels, roles, and visible text. CLI tests spawn the actual entrypoint. GitHub behavior is exercised through a local HTTP server implementing authenticated users and mutable workflow-run records, with real HTTP requests and production decoding.

The fake GitHub service establishes application behavior, not real GitHub permissions or provider compatibility. The separate manual workflow experiments record actual GitHub and pinned Codex observations; they are excluded from normal tests and linting.

Tests own and close their servers, DOM views, and child processes. They do not use real sleeps, fetch interception, or mocked application modules. Product changes must first demonstrate a failing Given-When-Then acceptance scenario.

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

Claude sharing tests use a stateful GitHub HTTP service with actual RSA-OAEP/AES-GCM messages and LibSodium Secret sealing. The fake service decrypts the published Secret to verify its value. Worker integration starts a real external provider fixture process: Linux uses the production PTY transport; Windows uses pipes. A controlled clock with an explicit date advances polling without real sleeps. Scenarios include successful authorization, code rejection, duplicate code messages, cancellation, wrong authors/run attempts, cross-Issue ciphertext, expiration, and nonofficial authorization URLs. These fixtures establish protocol/control behavior, not acceptance by a real Claude account, real GitHub Secrets permissions, or actual browser CSP compatibility. The pinned official CLI's `setup-token --help` was checked; no real account was authorized.

Launcher regression scenarios also cover focus after malformed authorization-code submission, duplicate clicks creating only one task, and reconnecting while a previous HTTP response is held. They enter through the complete React launcher and visible controls, without testing reducers or hooks in isolation. DOM observers await settled accessible status; they do not poll or sleep.

Tests own and close their servers, DOM views, and child processes. They do not use real sleeps, fetch interception, or mocked application modules. Product changes must first demonstrate a failing Given-When-Then acceptance scenario.

Public-repository acceptance now exercises the same encrypted login/sharing path instead of rejecting repository visibility. Worker diagnostic records and real CLI stderr are checked for secret disclosure. Manual runner observations must be recorded separately from fixture expectations; a fake transcript is evidence only after it matches the observed pinned CLI behavior.

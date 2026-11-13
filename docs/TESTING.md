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

Claude sharing tests use a stateful GitHub HTTP service with actual RSA-OAEP/AES-GCM messages and LibSodium Secret sealing. The fake service decrypts the published Secret to verify its value. Worker integration starts a real external provider fixture process: Linux uses the production PTY transport; Windows uses pipes. A controlled clock with an explicit date advances polling without real sleeps. Scenarios include successful authorization, code rejection, duplicate code messages, cancellation, wrong authors/run attempts, cross-Issue ciphertext, expiration, and nonofficial authorization URLs. These fixtures establish protocol/control behavior, not acceptance by a real Claude account, real GitHub Secrets permissions, or universal browser CSP compatibility. A subsequent user-supervised run authorized a real Claude account and published its token; that empirical result is recorded separately from fixture coverage.

Journey acceptance covers three independent destinations, no authorization controls on the usage page, continuing an encrypted Claude exchange after visiting usage, cancellation returning to sharing settings, and refusing a second runner across destinations. These tests use the complete launcher against stateful HTTP services; they do not establish real OAuth or Codex availability.

Launcher regression scenarios also cover focus after malformed authorization-code submission, duplicate clicks creating only one task, and reconnecting while a previous HTTP response is held. They enter through the complete React launcher and visible controls, without testing reducers or hooks in isolation. DOM observers await settled accessible status; they do not poll or sleep.

Tests own and close their servers, DOM views, and child processes. They do not use real sleeps, fetch interception, or mocked application modules. Product changes must first demonstrate a failing Given-When-Then acceptance scenario.

Public-repository acceptance now exercises the same encrypted login/sharing path instead of rejecting repository visibility. Worker diagnostic records and real CLI stderr are checked for secret disclosure. Manual runner observations must be recorded separately from fixture expectations; a fake transcript is evidence only after it matches the observed pinned CLI behavior.

The first real authorization run failed on the old full-code echo assumption: [run 43356819899](https://github.com/taowen-paraflow/shared-morty/actions/runs/43356819899). An official-CLI probe using synthetic input and no Enter established that version 2.1.323 masks all but six input characters: [probe 43357758141](https://github.com/taowen-paraflow/shared-morty/actions/runs/43357758141). The external fixture now follows that observed behavior and reproduces the old adapter failure. Sanitized observations and unverified branches are recorded in `experiments/claude-live-results.json`; the corrected real retry succeeded in [run 43358458456](https://github.com/taowen-paraflow/shared-morty/actions/runs/43358458456). The browser then published `SHARED_CLAUDE_TOKEN`, confirmed by repository Secret metadata. The observed success markers and 108-character sample inform the fixture, while decorative text/wrapping and synthetic error branches are not claimed as literal captured frames.

The public logs and Issue comments from the successful real run were scanned for token, OAuth URL/code, and PKCE query shapes. No such shapes were found; all three comments validate as encrypted protocol envelopes. This is supporting evidence, not a general proof of confidentiality. The real browser used the built launcher CSP with only a self-connection addition for the local one-use GitHub bootstrap endpoint. No model turn was created.

A separate VM consumed the repository Secret and ran official `claude auth status --json`: [run 43359580808](https://github.com/taowen-paraflow/shared-morty/actions/runs/43359580808) reported `loggedIn=true`, `authMethod=oauth_token`, and the observed token length. This confirms GitHub Secret decryption/injection and CLI recognition; it does not establish inference success or multi-user concurrency. No model turn was created. The temporary local bootstrap server was stopped after the browser flow.

A later explicitly requested inference probe used the same Secret with official CLI 2.1.323 in a fresh isolated VM: [run 43366687430](https://github.com/taowen-paraflow/shared-morty/actions/runs/43366687430). It completed one Sonnet turn and matched the expected synthetic answer. Tools and session persistence were disabled. Only validated outcome metadata was logged; token/OAuth/code/PKCE pattern scans found no matches. This establishes actual inference with the shared credential, not launcher/Morty chat, tool execution, other member permissions, history isolation, or concurrent usage. `claude-shared-probe.yml` defaults to status only; explicitly select `mode=inference` to repeat the model request.

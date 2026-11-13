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

The fake GitHub service establishes application behavior, not real GitHub permissions or provider compatibility. The separate manual workflow experiments record actual GitHub and Claude observations; they are excluded from normal tests and linting.

Claude sharing tests use a stateful GitHub HTTP service with actual RSA-OAEP/AES-GCM messages and LibSodium Secret sealing. The fake service decrypts the published Secret to verify its value. Worker integration starts a real external provider fixture process: Linux uses the production PTY transport; Windows uses pipes. A controlled clock with an explicit date advances polling without real sleeps. Scenarios include successful authorization, code rejection, duplicate code messages, cancellation, wrong authors/run attempts, cross-Issue ciphertext, expiration, and nonofficial authorization URLs. These fixtures establish protocol/control behavior, not acceptance by a real Claude account, real GitHub Secrets permissions, or universal browser CSP compatibility. A subsequent user-supervised run authorized a real Claude account and published its token; that empirical result is recorded separately from fixture coverage.

Journey acceptance covers two independent destinations, no authorization controls on the usage page, continuing an encrypted Claude exchange after visiting usage, cancellation returning to sharing settings, and refusing a second runner across destinations. These tests use the complete launcher against stateful HTTP services; they do not establish real OAuth availability.

Launcher regression scenarios also cover focus after malformed authorization-code submission, duplicate clicks creating only one task, and reconnecting while a previous HTTP response is held. They enter through the complete React launcher and visible controls, without testing reducers or hooks in isolation. DOM observers await settled accessible status; they do not poll or sleep.

Tests own and close their servers, DOM views, and child processes. They do not use real sleeps, fetch interception, or mocked application modules. Product changes must first demonstrate a failing Given-When-Then acceptance scenario.

Public-repository acceptance now exercises the same encrypted login/sharing path instead of rejecting repository visibility. Worker diagnostic records and real CLI stderr are checked for secret disclosure. Manual runner observations must be recorded separately from fixture expectations; a fake transcript is evidence only after it matches the observed pinned CLI behavior.

The first real authorization run failed on the old full-code echo assumption: [run 43356819899](https://github.com/taowen-paraflow/shared-morty/actions/runs/43356819899). An official-CLI probe using synthetic input and no Enter established that version 2.1.323 masks all but six input characters: [probe 43357758141](https://github.com/taowen-paraflow/shared-morty/actions/runs/43357758141). The external fixture now follows that observed behavior and reproduces the old adapter failure. Sanitized observations and unverified branches are recorded in `experiments/claude-live-results.json`; the corrected real retry succeeded in [run 43358458456](https://github.com/taowen-paraflow/shared-morty/actions/runs/43358458456). The browser then published `SHARED_CLAUDE_TOKEN`, confirmed by repository Secret metadata. The observed success markers and 108-character sample inform the fixture, while decorative text/wrapping and synthetic error branches are not claimed as literal captured frames.

The public logs and Issue comments from the successful real run were scanned for token, OAuth URL/code, and PKCE query shapes. No such shapes were found; all three comments validate as encrypted protocol envelopes. This is supporting evidence, not a general proof of confidentiality. The real browser used the built launcher CSP with only a self-connection addition for the local one-use GitHub bootstrap endpoint. No model turn was created.

A separate VM consumed the repository Secret and ran official `claude auth status --json`: [run 43359580808](https://github.com/taowen-paraflow/shared-morty/actions/runs/43359580808) reported `loggedIn=true`, `authMethod=oauth_token`, and the observed token length. This confirms GitHub Secret decryption/injection and CLI recognition; it does not establish inference success or multi-user concurrency. No model turn was created. The temporary local bootstrap server was stopped after the browser flow.

A later explicitly requested inference probe used the same Secret with official CLI 2.1.323 in a fresh isolated VM: [run 43366687430](https://github.com/taowen-paraflow/shared-morty/actions/runs/43366687430). It completed one Sonnet turn and matched the expected synthetic answer. Tools and session persistence were disabled. Only validated outcome metadata was logged; token/OAuth/code/PKCE pattern scans found no matches. This establishes actual inference with the shared credential, not launcher/Morty chat, tool execution, other member permissions, history isolation, or concurrent usage. `claude-shared-probe.yml` defaults to status only; explicitly select `mode=inference` to repeat the model request.

Personal-chat acceptance renders the complete launcher against the stateful GitHub HTTP service and starts real external fixture processes through the same Claude/Morty CLI boundaries. It exercises encrypted handoff, one-run ownership, navigation continuity, controlled-clock normal stop, temporary-directory deletion, suppressed provider stderr, unsafe handoffs, wrong authors/keys/attempts/AAD, and expiry. The service sends GitHub-like max-age=60 headers; mutable reads must still see new state. The fake processes reproduce the pinned JSON/NDJSON contract; they do not prove real Morty connectivity, provider tool behavior, other member permissions, or concurrent use. New chat control messages do not change the existing login protocol.

The real personal-chat browser runs are [43369263594](https://github.com/taowen-paraflow/shared-morty/actions/runs/43369263594) and the corrected [43370609941](https://github.com/taowen-paraflow/shared-morty/actions/runs/43370609941). The first completed browser messaging, a one-time terminal permission, file write/read, and model reply; it also exposed caching and force-cancel cleanup limitations. The second verified a fresh workspace, another reply, normal owner stop, successful job completion, automatic Issue closure, launcher idle, and Morty offline. Metadata and log/Issue pattern scans are recorded in `experiments/personal-chat-results.json`. The authenticated flows used a one-use local GitHub bootstrap with the exact deployed launcher assets; public Pages loading and matching asset hashes were checked separately. No second real member, concurrency, encrypted history restore was tested.


Refactor regressions invoke both public login/chat CLIs with unsupported events, extra arguments, and an unsafe Issue number to confirm rejection before provider execution. Chat boundary scenarios also confirm that late ready messages cannot revive a stopped task or conceal a prior error. These are boundary/integration checks, not tests of hooks or private reducers.


Connection-guide scenarios render the full launcher, verify the default repository and GitHub template owner/permissions, change the target through visible controls, check the separate Secrets permission template, reject invalid repository templates, and connect against the stateful GitHub HTTP service with a cleared password field. They establish launcher behavior, not GitHub token issuance, organization approval, or new token persistence.

Browser recovery acceptance remounts the full app against the stateful GitHub HTTP provider using the native IndexedDB API emulated by fake-indexeddb. Controlled launcher clocks trigger automatic polls without sleeps. Scenarios cover waiting/ready/stopping reloads, failed Actions without bot messages, expired or wrong-owner connections, terminal checkpoint removal and navigation. The emulator establishes application behavior, not actual browser CryptoKey persistence; a real Chromium reload and real GitHub/Morty run are recorded separately.

2026-11-13 刷新恢复实测：[run 43376282942](https://github.com/taowen-paraflow/shared-morty/actions/runs/43376282942)，源码 4b75b48。真实 Chromium 自动显示就绪；整页刷新后 GitHub 自动重连、原生 CryptoKey 恢复，解密得到同一会话入口；在 Morty 收到合成消息的预期回复。正常停止后刷新确认终态，Actions success、Issue 6 自动关闭、cleaned_up、Morty Offline。公开日志和评论的凭据 / transfer / OAuth code / PKCE / 合成聊天文本定向扫描均未命中。另一真实 actor 的 run 43373788316 同时仍在运行，未被本次控制；这不代表已验证双方聊天数据隔离。认证测试用同一构建的 localhost 一次性 GitHub bootstrap；未测试浏览器进程重启、跨站点迁移、归档。记录见 `experiments/personal-chat-results.json` 的 refreshRecovery。

Token 引导修正：GitHub 官方当前不支持 repository / outside collaborator 使用 fine-grained Token。个人账号 taowen-paraflow 的仓库协作者 taowen 应用本人的 classic Token；不能将 taowen-paraflow 强行作为其 fine-grained Resource owner，也不共享所有者的 GitHub Token。taowen 的写权限已由真实 API 确认；真实聊天 run 43376282942 的 actor 也是 taowen。该证据来自现有 classic 凭据，不代表已经验证新 Token 的签发。引导测试只验证链接和可见说明，不模拟 GitHub 发证策略。[Token 限制](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)；[dispatch 的 classic repo scope 要求](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。

---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# Engineering rules

These rules adapt Morty's engineering practices to shared-morty. Read [Contributing](docs/CONTRIBUTING.md), [Testing](docs/TESTING.md), and [Code review](docs/CODE_REVIEW.md) before changing product behavior.

## Product scope

- Keep the static launcher, Actions runner, and shared contracts in one small TypeScript project. Add boundaries for real use cases, not hypothetical extensions.
- Do not introduce a database, permanent control service, download/export flow, or per-member OAuth authorization.
- A user has one running runner across login and both Agents. Different users can run concurrently. Shared credentials and personal history have different ownership and encryption keys.
- Treat the manual experiments under `experiments/` as research evidence, not production modules or the default automated test suite.

## Trust and contracts

- Decode remote and persisted values as `unknown`, validate schemas, normalize targets, authorize at the execution boundary, execute, then record sanitized outcomes.
- Derive user identity from authenticated GitHub responses or verified Actions context. A caller-provided user ID or display name is not authority.
- Never log tokens, auth files, personal keys, chat content, or URLs carrying access codes. Pass only required environment values to child processes.
- Represent lifecycle states with readonly discriminated unions and exhaustive transitions. Avoid combinations of flags and optional fields.
- Use readonly contract properties and function-property ports. Do not bypass validation with `any`, non-null assertions, `Partial`, or type assertions.
- Use typed boundary errors with stable codes; distinguish cancellation, timeout, authentication, permissions, invalid data, and transient failures. Preserve causes internally and sanitize user-visible messages.
- External operations accept cancellation. Bound finite requests and pagination, propagate cancellation, and release processes, servers, locks, timers, and listeners on every exit path.
- Preserve existing external behavior and saved formats. Changes to protocols require explicit compatibility decisions and evidence for affected older peers.

## Delivery and tests

- Start behavior changes with a failing Given-When-Then acceptance scenario at a supported product boundary. Deliver the smallest runnable slice with observable output.
- Prefer integration and contract tests. Do not add unit tests by default or tests for package scripts, CI, lint configuration, or other scaffolding.
- Web integration tests render the whole application and use visible controls. CLI tests invoke the public CLI. Assert results, not private call counts or implementation structure.
- Do not mock fetch, replace modules, spy on implementation calls, or use canned request interceptors. A stateful fake external system is allowed through its production HTTP boundary.
- Time-dependent automated tests use controlled clocks with an explicit time; no real sleeps or timing tolerances. The existing manual GitHub experiments are a separately authorized empirical workflow, not a precedent for timed product tests.
- Use the pinned Node/pnpm versions and lockfile. Run `pnpm lint`, `pnpm typecheck`, relevant tests, and build before delivery; verify the pushed CI result.

## Documentation and review

- Keep Markdown changes in documentation-only commits and PRs, separate from source, configuration, dependencies, and experiment data. Every Markdown file has `metadata.change-policy` frontmatter.
- The user explicitly requested file ownership and read/write inventories in `state.md`; preserve that document's purpose. Update product docs when behavior becomes implemented, without claiming unverified capabilities.
- Write code comments and commit messages in English. Describe limitations and actual validation evidence, including what a fake provider does not establish.
- Follow [Code review](docs/CODE_REVIEW.md) before reporting completion. Review policy does not require opening an unsolicited PR or asking again for work the user already authorized.

---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# shared-morty

Share Claude Code and Codex with your team while keeping personal conversations and execution environments separate.

The static launcher connects to GitHub, inspects the authenticated user's runners, dispatches an execution-environment check, refreshes status, and requests cancellation of owned tasks. The CLI also exposes status inspection. The check workflow verifies private-repository/default-branch execution and reports shared-secret presence; it does not start a chat. Account login/sharing, Morty integration, credential refresh, and encrypted history remain unimplemented.

Start with [Contributing](docs/CONTRIBUTING.md) for local commands, [Testing](docs/TESTING.md) for acceptance boundaries, and [Engineering rules](AGENTS.md) before making changes.

The intended state ownership is described in [state.md](state.md); user flows are in [user-journey.md](user-journey.md). Live GitHub experiment evidence is linked from the state document.

---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# shared-morty

Share Claude Code and Codex with your team while keeping personal conversations and execution environments separate.

The current foundation connects to GitHub and shows the authenticated user's runner state through a static launcher or CLI. Account sharing, runner dispatch, and encrypted history are specified in the design and are not implemented yet.

Start with [Contributing](docs/CONTRIBUTING.md) for local commands, [Testing](docs/TESTING.md) for acceptance boundaries, and [Engineering rules](AGENTS.md) before making changes.

The intended state ownership is described in [state.md](state.md); user flows are in [user-journey.md](user-journey.md). Live GitHub experiment evidence is linked from the state document.

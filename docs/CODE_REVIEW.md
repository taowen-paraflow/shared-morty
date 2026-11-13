---
metadata:
  change-policy: Documentation changes require a separate documentation-only commit and, when a PR is opened, a documentation-only PR for review and approval.
---

# Code review

Review the complete diff and exact commit being delivered.

- Confirm scope matches the user's constraints: no database, no permanent control service, and no unrelated features.
- Trace each external value from `unknown` through validation, normalization, authorization, side effects, and sanitized output.
- Check stable user identity, runner prefix and workflow ownership together; names and caller-supplied IDs are insufficient.
- Check lifecycle exhaustiveness, cancellation propagation, deadlines, and resource cleanup. An error or aborted request must not appear as an empty successful result.
- For changed saved formats or peer protocols, identify old/new readers and mixed-version evidence. For a new product boundary with no released peers, state that compatibility is not yet applicable.
- Inspect token handling, link construction, browser persistence, environment inheritance, and diagnostics for accidental disclosure.
- Confirm tests enter through the actual product boundary and cover the user-visible behavior. Fakes must remain external systems, not replacements for product code.
- Confirm checks passed for the delivered head and distinguish local fixture evidence from real GitHub or OAuth evidence.

Do not call a change ready when any required result is missing. Document concrete limitations without implying unimplemented behavior is available.

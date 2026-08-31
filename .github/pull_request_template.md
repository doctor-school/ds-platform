## Summary

<!-- 1-3 sentences: what changed and why -->

## Product note (RU)

<!--
2-4 sentences of the USER-VISIBLE change, in plain product Russian — what a person
would actually notice, naming the product entity (the webinar, the doctor's
registration, the admin's event form), no engineering jargon. This is the SINGLE
source of truth: on merge it is posted to the team's Mattermost channel and it IS
the session report's «Для пользователя» paragraph (skill `report-task-outcome`) —
author it once, mirror it here.

Write `none` for an internal-only PR (chore / CI / refactor / deps) — but `none`
on a `feature`/`bug`-labeled PR fails the `product-note` guard.
-->

none

## Linked

- Closes #<issue-number> (or "Relates #N" if partial)
- Spec: <link to apps/docs/content/specs/features/NNN-<slug>/ if feature-PR>
- ADR: <link to apps/docs/content/adr/NNNN-\*.md if architectural decision>

## Type

<!-- One label MUST apply; tracker enforces -->

- [ ] feature
- [ ] bug
- [ ] chore
- [ ] refactor
- [ ] docs

## Author

<!-- For reviewer-bot vendor detection (ADR-0007 §Negative) -->

- [ ] author:claude
- [ ] author:codex
- [ ] author:human

## Delivery evidence

<!--
Replace every angle-bracket placeholder below. The PR-body guard rejects missing,
placeholder, known-red, or failed evidence. Reasoned N/A examples:

- Stage-B: N/A (no visual surface) — lead-certified; authorization and live behavioral verification: <link>
- Changeset: N/A — internal-only tooling change with no user-facing package impact
- Behavior change: N/A — test-only change; runtime and user behavior are unchanged
- Deviations: N/A — no ADR/spec deviations

Local touched-suite verification always requires a concrete command and PASS;
N/A, known-red, or failed local suites are not acceptable evidence. Fix a local
failure or prove and resolve the same failure on origin/main before merge.
Any deviation from an ADR/spec clause must name its tracked `#<issue>` or an
exact `DEBT.md#<anchor>`.
-->

Stage-B: <GO with owner/date/link | batched at #N | reasoned N/A in the exact lead-certified form above>
Changeset: <`.changeset/<file>.md` | reasoned N/A>
Behavior change: <concise user/runtime behavior change | reasoned N/A>
Local touched-suite verification: <exact command(s) and PASS result>
Deviations: <ADR/spec clause — #N or DEBT.md#anchor | N/A — reason>

## Checklist

- [ ] Tests green (unit + e2e where applicable)
- [ ] `pnpm generate:all` artifacts up-to-date
- [ ] Linked spec status updated if applicable
- [ ] Changeset added if user-facing change (`pnpm changeset`)
- [ ] Glossary updated if new domain terms introduced

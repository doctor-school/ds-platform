## Summary

Adds a `pr-body` guard (`epic-autoclose`) to the `pr-body-guards.yml` family that
blocks a PR from silently auto-closing an EPIC/parent issue on merge. It parses
the GitHub closing keywords (`Closes`/`Fixes`/`Resolves #N`, case-insensitive)
from the PR body, reads each referenced issue's native sub-issue graph, and WARNs
when a referenced issue is a parent with ≥1 OPEN sub-issue — naming the open
children and telling the author to link the specific child sub-issue instead of
the epic. Root incident: a child PR wrote `Closes #927` and auto-closed the
release-cycle epic while it still had open sub-issues; nothing read the sub-issue
graph at PR time.

Design: a pure, platform-agnostic rule seam
`evaluateEpicAutoclose(prBody, graphLookup)` (unit-tested with fixture graph
data, no network) + a thin I/O wrapper that resolves the PR body via `lib/gh`
(honoring the #651 `PR_BODY` event-payload seam) and fetches OPEN children via
`gh api repos/{owner}/{repo}/issues/{N}/sub_issues`. Lives in the `edited`-event
trigger family, so it re-runs on PR body edits. Ships as **WARN** (ADR-0007 §2.6
new-guard posture); the single `SEVERITY` constant + the job's `continue-on-error`
are the one-line flip to BLOCK.

registry-research: n/a — tooling only, no UI surface touched.

## Product note (RU)

none

## Linked

- Closes #964

## Type

- [x] chore

## Author

- [x] author:claude

## Checklist

- [x] Tests green (13 new guard-tests: pure seam + exit-code harness)
- [x] `pnpm generate:all` artifacts up-to-date (n/a)
- [x] Linked spec status updated if applicable (n/a — tooling)
- [x] Changeset added if user-facing change (n/a — internal tooling)
- [x] Glossary updated if new domain terms introduced (n/a)

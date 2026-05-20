---
title: "do-adr-amendment"
description: "Orchestration skill: amend an existing ADR (EN+RU parity mandatory) and its paired design spec if present."
name: do-adr-amendment
mode: inline
---

# do-adr-amendment

**Kind:** orchestration · **Mode:** inline.

> **Cannot proceed without** — EN+RU parity for the amendment text, **and** parallel edits to the paired design-spec (`-design-en.md` / `-design-ru.md`) if one exists. A PR that lands the EN amendment without the RU mirror fails review on principle (spec §12 closed decision). The reviewer is instructed to REQUEST_CHANGES on language drift regardless of other findings.

## Input

- ADR number (e.g., `0007`).
- Reason for amendment: G11 finding ID, GitHub Issue link, Plane reference, or discussion link.
- Letter for the new amendment: next free letter in the sequence already used in the target ADR (e.g., if `A1` exists, the new one is `A2`; if `A1..A3` exist, the new one is `A4`). Per OQ-2 closed default: do not consolidate or renumber existing amendments.

## Procedure

1. **Read all four files** (RU + EN narrative + RU + EN design, where applicable). Confirm the current amendment letter sequence — do not skip letters.
2. **Draft the amendment in EN narrative** following the format already established in the ADR (Context / Decision / Consequences / Why now / Open follow-up / Affects). Match the indentation, sub-letter pattern (`A2.1`, `A2.2`, …), and section ordering used by prior amendments in the same file.
3. **Mirror to RU narrative** — semantically equivalent, not a literal calque. Russian technical terminology per the convention already established in the file.
4. **If a paired design-spec exists, mirror the amendment there** (EN + RU). Design-spec amendments use the `SD<N>` prefix per the convention established in `0007-ai-stack-design-en.md`.
5. **Cross-references** — add `Affects (downstream)` entries pointing at any ADRs / specs / Plane items the amendment touches.
6. `git push` + `gh pr create` (label `docs`, `Closes #N` if there is a tracking Issue).
7. **`request-mode-a-review`** (dispatch) — reviewer is instructed to verify EN+RU parity explicitly.
8. **`respond-to-review`** (inline) — loop until APPROVE.
9. **`merge-when-green`** (inline).

## Output

- ADR `0NNN-<slug>-{en,ru}.md` amended (next free letter).
- Paired design-spec `0NNN-<slug>-design-{en,ru}.md` amended if it exists.
- PR merged.

## Failure mode

- Landing the EN amendment without the RU mirror — the spec §12 closed decision on EN+RU parity exists specifically because this gap recurs. Reviewer-agent must REQUEST_CHANGES.
- Skipping the paired design-spec amendment when one exists — drift between ADR and its design rationale.

## Related skills

- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md)
- [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md)
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md)

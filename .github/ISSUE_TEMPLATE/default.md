---
name: Default (full context skeleton)
about: Comprehensive structure for any Issue — preferred default unless bug/feature/chore fits exactly
labels: []
---

**Source:** <!-- exactly one of: source:owner | source:spec | source:retro | source:agent — set the same value as the Issue's `source:*` label -->

## Context

<!-- Why now. What problem this solves. Links: parent spec
     `apps/docs/content/specs/features/NNN-<slug>/` or ADR-NNNN or, only as a
     rare exception, Plane DSP-XXX. -->

## Scope

**In scope:**

- <!-- concrete deliverable -->

**Out of scope:**

- <!-- what this Issue does not cover -->

## Spec reference

<!-- For a single EARS-handler: link to `NNN-requirements.md#EARS-N`.
     For an ADR revision: link to the ADR (and the specific § being changed).
     For scaffolding / tooling without a spec: write "no spec". -->

## Reuse

Reuse: <!-- exactly one of:
     canon: <packages/… or apps/api/… path already owning this capability —
            the existing block/composition when one renders the same read, not only its units>
     extract-from: <apps/portal/… or apps/doctor/… path> (#<extraction Issue>)
     new: <why nothing shared fits>
     MANDATORY on every Issue (`pnpm issue:create` fails
     closed without it). Answer key: apps/docs/content/specs/product/two-site-ia/capability-ownership.md
     — and grep apps/portal, apps/doctor, packages/ before writing `new:`. -->

## Storefronts

Storefronts: <!-- exactly one of:
     both
     academy-only: <why the doctor storefront is out — its sibling Issue #N, or why none>
     doctor-only: <why the Academy is out — its sibling Issue #N, or why none>
     none: <why no storefront page — admin / staff / sign-in host / tooling>
     MANDATORY on every Issue (`pnpm issue:create` fails closed without it, #3604).
     A spec-bound Issue follows its spec's `storefronts:` frontmatter. -->

## Acceptance criteria

- [ ] <!-- observable, checkable -->
- [ ] <!-- ... -->

## Dependencies

**Blocked by:** <!-- native GH "blocked by" relationships plus a one-line note where context is non-obvious -->
**Blocks:** <!-- outbound obligations -->

## Notes

<!-- Free text. Agents post stop-state comments here when interrupting
     work on an In Progress item — see the four-field shape in
     apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md §6. -->

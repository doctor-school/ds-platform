# @ds/showcase — Design System Living Showcase

The rendered viewer of [`@ds/design-system`](../../packages/design-system): every
token, primitive and block from the **real package**, rendered in every state on a
live URL. It is the design system's SSOT surface and the two-stage design-approval
surface (Stage-A research options, Stage-B owner approval) of
`build-ui-from-design-system`.

Design: [`design-system-showcase`](../docs/content/specs/tech/2026-06-29-design-system-showcase-design-en.md)
(epic [#340](https://github.com/doctor-school/ds-platform/issues/340), deliverable B).

## One design system, not two

This app is a **viewer**, not a second design system. It re-implements nothing: it
imports the same `@ds/design-system` exports over `workspace:*` that the product
apps (`apps/portal`) consume, so what it renders **is** what features compose
(spec §2.4). `app/globals.css` is the single `@import "@ds/design-system/globals.css"`,
identical to portal — the showcase owns no `@theme`, `@source` or token wiring of
its own. Drift of catalogue content is structurally impossible; the coverage guard
(WBS #350) and the retargeted Playwright+axe checks (WBS #351) keep it honest.

## Sections

- **Tokens** (#346) — every token class as specimens from the generated manifest.
- **Primitives** (#347) — every primitive × state/variant/size, with a states column.
- **Blocks** (#348) — `auth-card`, `auth-layout`, `otp-focus-screen` in key states.
- **Candidates / Stage-A** (#349) — the candidate/adopted seam (spec §4): 2–3
  researched candidate variants of an element class rendered beside the adopted
  entry, role-labelled, for the owner's Stage-A pick. Schema-stable surface
  (`app/_components/candidate-adopted.tsx`) — the `research-ui-element` subagent
  (deliverable A, #340) renders its options through it with no surface change.

## Run locally

```sh
pnpm --filter @ds/showcase dev      # http://localhost:3002
```

The dev stand (`pnpm dev:*`) backs the platform's services; the showcase itself is
a pure static viewer with no backend, so `next dev` is all it needs. Endpoints/ports
that do matter elsewhere are read from `.env.local`, never hardcoded.

## Scope

`apps/showcase` is an **internal dev surface**, not a product app — kept out of the
product bundles/navigation by living in its own app (spec §2.1). Storybook and
visual-regression stay deferred until ADR-0004 OQ-F9 triggers (≥2 frontend
developers / >20 components); this app is where they land when it does.

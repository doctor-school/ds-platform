---
"@ds/storefront-shell": minor
"@ds/portal": minor
"@ds/doctor": minor
"@ds/design-system": minor
---

One shared storefront shell for both storefronts (#2180). The topbar, header,
footer and theme control now live in `@ds/storefront-shell`, built from the
owner-approved `design-source/ds-shell.dc.html` canvas, and each host supplies
values only: a `lib/shell-config.ts` config object and an `auth: ShellAuthState`
DATA prop it maps its own session onto — the cluster's markup, geometry and press
chain are the package's, so neither host can draw its own chip. The Doctor showcase mounts the pair from its `(storefront)` layout; the
Academy mounts the header through its three `@chrome` slots and the footer —
new to that host, 008 EARS-14 — from the root layout. The six host twins
(`app-shell-header`, `header-user-cluster`, `storefront-header`,
`storefront-footer`, and both `theme-toggle` copies) are deleted, closing the
2026-09-03 duplicated-theme-toggle debt line.

`minor` on all four: `@ds/storefront-shell` is net-new to `main` (additive),
both apps gain shell surface rather than losing a capability, and
`@ds/design-system` gains five additive tokens for the canvas-exact chrome —
`--font-size-topbar` / `--font-letter-spacing-topbar` (the 9px / .22em BBM
micro-band), `--container-search` (the 440px desktop search cap) and
`--font-size-chip` / `--spacing-chip-x` (the 13.5px / 22px header-chip geometry).
The `on-primary` Button variant IS that chip now: it absorbs the deleted
`HEADER_CHIP_BASE` constant, loses its `border-2` (the canvas paints none) and
gains the `chip` and `avatar` sizes, so the chip changes in ONE place for both
storefronts. Every other `on-primary` call site loses the border with it. Three
visible deltas ride along — the storefront footer appears on every non-auth,
non-room Academy route; the guest control is the ONE «Войти / Регистрация»
chip of the canvas on BOTH hosts (the Academy label was «Войти», the Doctor
showcase drew a «Войти» + «Регистрация» pair), one cluster at every width
instead of a separate entry inside the mobile `≡` menu (017 EARS-1 forbids a
second cluster in the DOM); the Doctor header search stops at the canvas cap
instead of spanning the bar; and the BBM topbar's micro type moves onto the band
itself, so its text is centred in the band rather than riding the body's
line-height strut.

The BBM topbar keeps the contrast the canvas paints; that is an owner-accepted
a11y exception recorded as Issue #2189 and carried in the e2e axe scans as a
single leaf-scoped node exclusion.

The chrome's look lives in the primitives, not at the shell's call sites:
`@ds/design-system` gains `Input variant="header"` (the navy-band search field),
`Link` `tone="header-nav" | "neutral"`, `variant="wrapper" | "mobile-nav-row"`,
`size="sm"` and `weight="strong"`, `Button tone="header"`, and a new
`DisclosureSummary` primitive (the `≡` control as the on-header chip). Every
value is the canvas value, moved — the rendered result is unchanged — and the
four shell files are consequently NOT on the `local/no-primitive-style-override`
legacy baseline, which now stands at 143 hits across 23 files.

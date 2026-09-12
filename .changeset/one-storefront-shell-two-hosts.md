---
"@ds/storefront-shell": minor
"@ds/portal": minor
"@ds/doctor": minor
---

One shared storefront shell for both storefronts (#2180). The topbar, header,
footer and theme control now live in `@ds/storefront-shell`, built from the
owner-approved `design-source/ds-shell.dc.html` canvas, and each host supplies
values only: a `lib/shell-config.ts` config object and an `authCluster` slot
filler. The Doctor showcase mounts the pair from its `(storefront)` layout; the
Academy mounts the header through its three `@chrome` slots and the footer —
new to that host, 008 EARS-14 — from the root layout. The six host twins
(`app-shell-header`, `header-user-cluster`, `storefront-header`,
`storefront-footer`, and both `theme-toggle` copies) are deleted, closing the
2026-09-03 duplicated-theme-toggle debt line.

`minor` on all three: `@ds/storefront-shell` is net-new to `main` (additive),
and both apps gain shell surface rather than losing a capability. Two visible
Academy deltas ride along — the storefront footer appears on every non-auth,
non-room route, and the guest «Войти» chip is now one cluster at every width
instead of a separate entry inside the mobile `≡` menu (017 EARS-1 forbids a
second cluster in the DOM).

The BBM topbar keeps the contrast the canvas paints; that is an owner-accepted
a11y exception recorded as Issue #2189 and carried in the e2e axe scans as a
single leaf-scoped node exclusion.

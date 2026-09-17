---
"@ds/storefront-shell": patch
"@ds/portal": patch
---

The Academy's signed-in header carries «Мои события» again (#2243, 008
EARS-5/11). The canvas draws the link inside the auth cluster
(`design-source/ds-shell.dc.html`, `user.links` line 209, rendered at line 33 on
desktop and as an `≡` row at line 50); it was lost when the Academy moved onto
the shared chrome in #2198, because the owner's 2026-09-10 «Эфиры alone»
decision — which is about the TOP NAV — was read as if it covered the cluster
too.

`ShellAuthState`'s signed-in branch gains an optional `links: ShellLink[]`, so
the destination is a host VALUE like every other difference between the two
storefronts: the Academy passes «Мои события» → `/account/events`, the Doctor
showcase passes none (canvas `user.links` line 192 is empty) and its cluster is
unchanged, byte for byte. The package decides where the link is drawn at each
width — beside the chip on desktop, as a row after the nav rows in the `≡`
menu — so exactly one auth cluster still reaches the DOM (017 EARS-1). The top
nav is untouched on both hosts.

`apps/portal/lib/navigation-model.ts` gains the matching row, so the derived
navigation walk visits `/account/events` as the golden signed-in doctor.

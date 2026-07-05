---
"@ds/design-system": minor
---

Add the layout & spatial-rhythm foundation (#514, canvas §09): the `Container`
layout primitive (content 1104 / calendar 1240 max-widths, `margin-inline:auto`,
fixed 16px mobile gutter → fluid 16→48px desktop gutter), a `desktop` (901px)
layout breakpoint token driving the `desktop:` Tailwind variant, and the semantic
spacing ROLE tokens over the 4px scale — `--space-inset-*` (16/20/24/30),
`--space-stack` (28→0 mobile), `--space-section-*` (44/48), `--space-control-*`
(8/10/12), `--space-inline-*` (6/8), `--space-band` (0). New 4px-scale steps
`space.7-5` (30px) and `space.11` (44px) back the roles. Roles are documented in
the package README and demonstrated at both breakpoints in the showcase
`/layout-rhythm` composition.

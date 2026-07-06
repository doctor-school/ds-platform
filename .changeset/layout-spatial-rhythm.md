---
"@ds/design-system": minor
---

Add the §09 «Раскладка и ритм» layout & spatial-rhythm system to `@ds/design-system` (source `design-source/design-system.dc.html` §09 + §03). Space is now composed by semantic **ROLE**, not by eye:

- **Container** primitive (`./container`, `content` | `calendar` variants) — centres the content column, caps it (1104px / 1240px), and owns the responsive gutter + breakpoint: at/above the new `layout` breakpoint (901px) the cap engages with a `clamp(16px, 4vw, 48px)` gutter; below it the column goes edge-to-edge on a fixed 16px gutter so day-band plates and cards can bleed.
- **Semantic spacing-role tokens** over the §03 4px scale, surfaced as named Tailwind utilities via the `--spacing-<role>` `@theme` namespace: `inset` (`p-inset`), `stack` (20px mobile / 28px desktop — `space-y-stack-sm layout:space-y-stack`), `section` (48px desktop / 32px `section-sm` between mobile day groups — mobile rhythm = 20 intra-day / 32 between days is a recorded owner Stage-B decision, 2026-07-06, superseding the canvas's flush mobile gaps), `controls` (`gap-controls`), `inline` (`gap-inline`), `gutter` (`px-gutter` / `-mx-gutter` bleed), `day-band` (0 / bleed).
- **Tokens:** `container.content`/`container.calendar` (→ `max-w-content` / `max-w-calendar`), the `breakpoint.layout` threshold, and the `semantic.space.*` role group; plus the webinar-card canvas dimensions — `font.size.eyebrow` (11px, `text-eyebrow`), `font.size.title-lg` (24px listing-card title, `text-title-lg`), `webinar-card.time-plate` (196px time plate, `w-time-plate`) and the `tracking-numeric` utility (−.04em tabular-time tracking). `tokens.css` + `allowed-tokens.json` regenerated (tokens-fresh idempotent).

Token-only, square, both themes. Documented in the package README (Layout & spatial rhythm §09); the showcase gains a live **Layout & rhythm** composition rebuilt element-by-element from the vendored `webinar-card.dc.html` + `webinars-listing.dc.html` canvases — desktop bordered cards with the 196px time plate and blue offset casts, mobile flat full-bleed cards separated by their tint plates, both breakpoints × both themes.

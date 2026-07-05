---
"@ds/design-system": minor
---

Add the nine primitives the neo-brutalist visual language (#511) introduces, each token-only and catalogued in the showcase in both themes: **FilterChip** (Radix Toggle → `aria-pressed`; rest / hover / selected / disabled), **Badge** (`live` — destructive red, UPPERCASE, pulsing dot — plus tonal `label` / `speaker` tint), **Avatar** (Radix; `solid` btn-bg / `tint` initials), **Checkbox** (Radix; off / on with ✓ / disabled — the register-consent dependency), **RadioGroup / RadioGroupItem** (Radix; off / on), **Switch** (Radix; off / on), **Alert** (info / success / warn / danger — 2px border, tint surface, status icon), **Skeleton** (livePulse shimmer), and **DayBand** (full-bleed section label plate). Each carries its own state + a11y test coverage. New deps: `@radix-ui/react-{checkbox,radio-group,switch,avatar,toggle}`.

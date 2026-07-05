# `design-source/` — imported Claude Design canvas (single source of truth)

This folder holds the **actual design source** for the Doctor.School neo-brutalist visual language, imported verbatim from the Claude Design project **«Doctor.School визуальный язык»** (`8cc2f39a-d58e-4491-b539-4337881ced4f`).

> **Build to these files, NOT to issue-body prose.** The `.dc.html` inline styles carry the exact values — px, border widths, colors (light + dark), states, and placeholder copy. Issue descriptions are a lossy transcription and a coverage checklist, **not** the fidelity spec. Where prose and this source disagree, **the source wins**. (The neo-brutalist re-skin diverged the first time precisely because it was built from prose instead of this HTML.)

## Files

| File | What it is |
| --- | --- |
| `design-system.dc.html` | The 9-section visual language: **01** color · **02** type · **03** spacing · **04** borders/radius/shadows · **05** components · **06** states · **07** forms & validation · **08** feedback · **09** layout & rhythm. Exact token values are in the `renderVals()` block at the bottom (light `d=false` / dark `d=true`). |

## Which issues build against this

- **DS foundation** — `#510` (parent) → `#512` core primitives · `#513` new primitives · `#514` layout & rhythm · `#515` showcase/a11y capstone → **`design-system.dc.html`** (all sections; component geometry in §05–§08, layout in §09).
- **Auth re-skin** — `#516`–`#520` → `Авторизация.dc.html` *(loaded here at the start of the auth phase).*
- **Webinars** — `#471` → `Эфиры.dc.html`, `Вебинар.dc.html`, `ВебинарКарточка.dc.html`, `Комната эфира.dc.html`, `Мои события.dc.html`, `Направления.dc.html`, `Эфиры месяц.dc.html` *(loaded here at the start of the webinars phase).*

## Provenance & how to refresh

- **Project:** <https://claude.ai/design/p/8cc2f39a-d58e-4491-b539-4337881ced4f>
- **This file:** <https://claude.ai/design/p/8cc2f39a-d58e-4491-b539-4337881ced4f?file=%D0%94%D0%B8%D0%B7%D0%B0%D0%B9%D0%BD-%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D0%B0.dc.html>
- **Re-pull the exact bytes:** `DesignSync get_file` against project `8cc2f39a` (canvas filename `Дизайн-система.dc.html` — renamed to ASCII `design-system.dc.html` here for cross-platform/tooling safety; content is byte-identical).
- **View it live:** open the Claude Design link above. The DC runtime (`support.js`) that renders the `<x-dc>` template is not vendored here — re-pull it via `DesignSync get_file` on `support.js` if you ever need to render locally (it expects `window.React` / `window.ReactDOM` globals).

## Notes

- The canvas references logo assets `assets/ds-logo-{color,icon,white}.svg`. Those live in the Claude Design project; the repository's own brand marks are at `apps/portal/public/brand/`. They are intentionally not duplicated here — this folder is a **spec reference**, not a runnable app.
- Per ADR-0014 §4 the canvas is *source*, the repo holds the *built artifact* (the `@ds/design-system` React components). This folder is the pinned build reference the components are verified against; it is not itself shipped.
- This folder is `.prettierignore`d so the imported bytes stay verbatim.

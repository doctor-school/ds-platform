---
title: "DS Platform — Brand → Token Map (Doctor School)"
description: "Maps the Doctor School brand book (apps/docs/brandbook) onto the design-system token taxonomy: primary blue palette, status colors (brand green/orange + an introduced functional red), Inter as the UI base font, reserved accent palettes and display fonts. Companion to the design-system foundation design."
slug: design-system-foundation-brand-token-map
status: In design
tracker: https://github.com/doctor-school/ds-platform/issues/231
lang: en
---

# DS Platform — Brand → Token Map (Doctor School)

**Date:** 2026-06-17
**Companion to:** [`2026-06-17-design-system-foundation-design-en.md`](./2026-06-17-design-system-foundation-design-en.md) (§2 token taxonomy, §6 brand integration)
**Source:** `apps/docs/brandbook/brandbook-presentation.pdf` (§2.2 Colors, §2.3 Fonts) + `apps/docs/brandbook/logo/`

This map fixes the **brand intent** behind each token. Concrete primitive ramp stops, the type scale, radius, spacing, shadow, motion and z-index that the brand book does not specify are **system-defined** at implementation (noted as `system`); the brand book pins the values it does define.

---

## 1. Color

### 1.1. Primitive layer — brand-pinned

Brand book §2.2 "Основные цвета" (primary blues + white) and the status hues:

| Primitive token           | HEX                                                   | Brand source                                                                                                           |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `color.white`             | `#FFFFFF`                                             | White (Pantone WHITE)                                                                                                  |
| `color.blue.700`          | `#114D9E`                                             | Дополнительный тёмный (Pantone Dark Blue C)                                                                            |
| `color.blue.500`          | `#2D84F2`                                             | **Основной** (Pantone 2727 C) — the brand primary                                                                      |
| `color.blue.300`          | `#6BB1F7`                                             | Дополнительный светлый (Pantone 284 C)                                                                                 |
| `color.green.500`         | `#009959`                                             | Brand green (status: success)                                                                                          |
| `color.orange.500`        | `#DF5726`                                             | Brand orange/terracotta (status: warning)                                                                              |
| `color.red.500`           | `system` (accessible red, finalised at impl)          | **Introduced** — the brand has no functional error red; required for destructive/error per accessibility/UX convention |
| `color.neutral.{0..1000}` | `system` (blue-tinted gray ramp derived from primary) | Brand book defines no gray ramp → system-derived                                                                       |

Intermediate blue stops (`blue.400/600/…`) for hover/pressed/tints are `system`-derived around the three brand anchors.

### 1.2. Primitive layer — RESERVED accent palettes (no semantic role yet)

Brand book §2.2 additional palettes (pages 16–21). Decision (#231): tokenise as **primitive reserves** for future category/gamification surfaces (`accent.*`, reserved namespace toward `game.*`); **not** wired to any semantic UI role in this foundation. Out of scope for the auth slice.

| Reserved token (anchor) | HEX stops (dark / mid / light)    |
| ----------------------- | --------------------------------- |
| `accent.purple`         | `#73428A` / `#9257AE` / `#D3BADE` |
| `accent.orange`         | `#B2431A` / `#DF5726` / `#F2BAA6` |
| `accent.gold`           | `#C5963A` / `#E4BC6C` / `#EFD8A9` |
| `accent.green`          | `#00331E` / `#00693D` / `#009959` |
| `accent.lime`           | `#70C143` / `#BDD631`             |
| `accent.lavender`       | `#B2A4D4`                         |
| `accent.sky`            | `#48A4DB`                         |

### 1.3. Semantic layer (referenced by components)

| Semantic token                                  | → references                                     | Notes                                                                                  |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `color.background`                              | `{color.white}`                                  | Light-first (medical white)                                                            |
| `color.foreground`                              | `{color.neutral.900}`                            | Blue-tinted near-black                                                                 |
| `color.primary`                                 | `{color.blue.500}` `#2D84F2`                     | Brand anchor — link/ring/icons/tints (not a white-text fill)                           |
| `color.primary-foreground`                      | `{color.white}`                                  |                                                                                        |
| `color.primary-action`                          | `{color.blue.700}` `#114D9E`                     | Accessible filled-action fill (Pantone Dark Blue C); white text 8.14:1 per ADR-0013 §7 |
| `color.primary-hover` / `color.primary-pressed` | `{color.blue.800}` `#0D3A77`                     | Hover/pressed of the action fill (visible delta, stays AA)                             |
| `color.ring`                                    | `{color.blue.300}` `#6BB1F7`                     | Focus ring                                                                             |
| `color.muted` / `color.muted-foreground`        | `{color.neutral.100}` / `{color.neutral.600}`    | muted-foreground AA on muted (6.77:1)                                                  |
| `color.border` / `color.input`                  | `{color.neutral.200}`                            |                                                                                        |
| `color.success` / `-foreground`                 | `{color.green.500}` `#009959` / `{color.white}`  | Brand green                                                                            |
| `color.warning` / `-foreground`                 | `{color.orange.500}` `#DF5726` / `{color.white}` | Brand orange                                                                           |
| `color.destructive` / `-foreground`             | `{color.red.500}` / `{color.white}`              | Introduced functional red                                                              |

**Dark theme:** deferred — the brand is light-first; dark is a future semantic override (no primitive duplication), authored when a dark surface is needed.

---

## 2. Typography

Brand book §2.3:

| Token                 | Font                 | Brand role                                    | Use in design system                                       |
| --------------------- | -------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `font.family.base`    | **Inter**            | "Основной шрифт — коммуникационные материалы" | **All portal UI** — body + headings                        |
| `font.family.display` | Tactic Sans Extended | "Для специальных проектов"                    | RESERVED — marketing/special surfaces (promo), not core UI |
| `font.family.brand`   | Century Gothic       | "Для логотипов проектов"                      | RESERVED — project logos / brand lockups                   |
| `font.family.social`  | Montserrat           | "Social Media"                                | RESERVED — social assets                                   |

Inter is web-available and the shadcn default → no fallback risk. Tactic Sans / Century Gothic are licensed brand faces; loaded only on the surfaces that use them.

**Type scale** (size / weight / line-height / letter-spacing): `system` — the brand book does not define a UI type scale; derived at implementation from Inter with a standard modular scale.

---

## 3. Other token classes

| Class                                    | Source   | Decision                                                                                                        |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `radius.*`                               | `system` | Brand book gives no UI corner-radius; system token (proposed value at impl, single SoT per §2.3 of the design). |
| `space.*`                                | `system` | Standard spacing scale; brand-neutral.                                                                          |
| `shadow.*` / elevation                   | `system` | Light, calm elevation matching the medical/clean tone.                                                          |
| `motion.*`                               | `system` | Calm, professional durations/easings.                                                                           |
| `z-index.*`, `opacity.*`, `breakpoint.*` | `system` | Brand-neutral.                                                                                                  |

---

## 4. Logo / assets

`apps/docs/brandbook/logo/` provides: full English lockup (`.ai/.svg/.png`, incl. white variant on a grid) and an icon-only mark (`logo/icon/DS logo без текста`). These back a `Logo` component with `full` / `icon` / `mono-white` variants (asset tokens), not raw `<img>` per surface.

> **Repo note:** `brandbook-presentation.pdf` is ~142 MB. Committing it into plain git bloats the repository permanently; recommend Git LFS or keeping the raw PDF out of git (the extracted values in this map are the durable artifact).

---

## 5. Open value-decisions deferred to implementation

- Exact `color.red.500` value (accessible against white + as a fill) — `system`, finalised with contrast checks.
- Full neutral ramp stops and intermediate blue stops — `system`, derived around brand anchors.
- Type scale, radius, spacing, shadow, motion values — `system`.

All such values live in `tokens/*.json` (the single source of truth) once implementation starts.

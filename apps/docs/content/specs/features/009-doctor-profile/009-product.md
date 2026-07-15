---
title: "Feature 009 — Doctor profile (PRD) — Superseded"
description: "Superseded pointer. The read-only doctor profile at `/account` was delivered via #770, not through a 009 EARS triplet. This PRD is retained as a Superseded record; do not author EARS from it."
slug: portal-surface-ia-009-doctor-profile-product
epic: ../../product/portal-surface-ia/brief.md
status: Superseded
superseded_by: https://github.com/doctor-school/ds-platform/issues/770
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`009-product-ru.md`](./009-product-ru.md)

> Epic: [Portal surface IA — product brief](../../product/portal-surface-ia/brief.md).

## Status: Superseded → #770

The read-only doctor profile this PRD scoped was **delivered via [#770](https://github.com/doctor-school/ds-platform/issues/770)**, not through a 009 EARS triplet. `/account` is now a real product profile — a poster header, the Профиль / Безопасность / Сессия sections, name inline-edit, an email + verified badge, phone («не указан» when absent), and sign-out — backed by `GET /v1/me/profile` (feature 003 **EARS-27 / EARS-28**), replacing the raw session-claims debug dump. The vertical-slice deliverable (a real authenticated own-profile read endpoint + the product surface) that this PRD called for is shipped.

**Do not author an EARS triplet from this PRD.** It is retained only as a decision record so the epic's 008/009 decomposition stays legible; the live behaviour is owned by #770 and feature-003 EARS-27/28.

### Residual to verify (not a new scope)

- **MFA / security state (former US-2).** This PRD asked the profile to describe the doctor's security state in product language. The shipped `/account` «Безопасность» section presents «Сменить пароль»; whether an explicit **MFA-on/off indicator** is shown was not confirmed against the shipped page. If the product owner wants that indicator, it is a **small follow-up on the shipped profile (#770 surface)**, filed as its own Issue — not a revival of feature 009.

_Superseded 2026-07-15 (owner decision). The portal shell that links to `/account` is feature **008** (restored alongside this pointer); the profile behind the link is #770._

---
title: "Feature 009 — Doctor profile (PRD)"
description: "Product requirements for the read-only doctor profile at `/account` — name, email, phone as product copy, MFA as a product state, and sign-out. Portal surface IA epic; source of the 009 EARS triplet (ADR-0014). Retires the session-claims debug dump; a vertical slice requiring a new authenticated own-profile read endpoint."
slug: portal-surface-ia-009-doctor-profile-product
epic: ../../product/portal-surface-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`009-product-ru.md`](./009-product-ru.md)

> Epic: [Portal surface IA — product brief](../../product/portal-surface-ia/brief.md) · approved variant A.

## Feature summary

The doctor's account home: **`/account` becomes a read-only profile**. The doctor sees their **name, email, and phone** as readable product copy, their **security state (MFA)** described in plain product language, and a **sign-out** action. This feature **retires the session-claims debug dump** currently at `/account` (raw `sub` in monospace, a `roles[]` array, and an `mfa` boolean read straight from `GET /v1/auth/session`) — a testers' surface, not a product profile. It is a **vertical slice, not UI-only**: the doctor's name / email / phone live in `user_mirror` but **no endpoint exposes them today**, so this feature requires a **new authenticated own-profile read endpoint**. Profile **editing is explicitly out of v1** (a tracked follow-up).

## User stories

- **US-1** — As a **doctor**, I open `/account` and see **my profile** — my **name**, **email**, and **phone** — as readable product copy, so my account home shows who I am, not a debug payload.
- **US-2** — As a **doctor**, I see my **security state** (whether MFA / two-factor is on) described in plain product language, so I understand how my account is protected — not a raw boolean.
- **US-3** — As a **doctor**, I can **sign out** from my profile.
- **US-4** — As a **doctor**, I **never** see raw session internals on my account home — no `sub` identifier, no role array, no boolean flags; the testers' debug surface is gone.

## Flows

**View profile (US-1, US-2):**

1. Logged-in doctor opens `/account` → the profile renders their name, email, phone (as available), and their MFA security state in product language.
2. A guest (no session) hitting `/account` is routed to login (unchanged auth behavior, feature 003) — the profile is a private surface.

**Sign out (US-3):**

1. Doctor taps sign-out on the profile → the session ends (feature 003 logout) → the doctor is returned to a public state.

## Product acceptance criteria

- `/account` renders the **caller's own** name, email, and phone as **product copy**, plus their **MFA state** as a product-language description, plus a **sign-out** action.
- **The session-claims debug dump is retired** — no raw `sub` (monospace), no `roles[]` array, no `mfa` boolean is presented to the doctor.
- **A new authenticated own-profile read endpoint is required** (working name `GET /v1/me/profile`): it returns the **caller's own** name / email / phone and MFA state. The profile fields exist in `user_mirror` but no endpoint exposes them today — this is a real backend deliverable in the same slice, **not** a UI-only re-skin (F-22 vertical-slice rule, AGENTS.md §6).
- The profile is **read-only in v1** — it presents identity and security state and offers sign-out; it offers **no edit affordance**.
- The endpoint returns **only the caller's own** profile — a doctor never sees another user's fields.

## Out of scope

- **Profile editing** — changing name, phone, email, or any field is a **tracked follow-up iteration**, not a silent stub in this feature.
- Avatar / photo, specialty, NMO progress, or any richer profile content — future iterations.
- Security management UI (enabling/disabling MFA, changing password) — the profile _shows_ the security state; it does not manage it here.
- Notification preferences.
- The persistent header (and its avatar-icon entry) that links to `/account` — feature 008.

## Open questions

- **Which fields** beyond name / email / phone / MFA the v1 profile shows (e.g. specialty, registration date) — owner taste call at the Stage-A mockup; the brief keeps v1 minimal.
- **Missing phone.** Registration is email-primary and phone may be absent for a given doctor (memory: single identifier = email) — how the profile presents an **absent phone** (omit the row, show «не указан», or an "add phone" hint that anticipates the edit follow-up) — owner decision before the 009 EARS triplet fixes it.
- How **MFA state** is worded for a doctor in product language (e.g. «Двухфакторная защита включена») — Stage-A copy call.

## Approved mockup

**Status:** **composed from the established neo-brutalist design language** — there is **no dedicated canvas** for the profile (owner decision 2026-07-12). It is built from `@ds/design-system` primitives (**Container / Card / Badge / Button**) inside the vendored portal-shell header (feature 008), following the «Doctor.School визуальный язык». No claude.ai/design Stage-A pick is required for this surface; the design gate before merge is the **Stage-B live-verify on the running dev stand** (ADR-0014 §4–5).

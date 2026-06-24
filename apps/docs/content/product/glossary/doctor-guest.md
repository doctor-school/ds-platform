---
title: "doctor_guest"
description: "The v1 self-service backend role and mirror identity granted to a net-new visitor who self-registers on the doctor portal."
lang: en
---

# doctor_guest

**Bounded context:** identity · **Canonical id:** `doctor_guest`

`doctor_guest` is the coarse v1 role a net-new visitor receives when they
self-register on the doctor portal. It is the identity produced by the first
authentication feature (003): a self-service web registrant who has obtained a
backend identity but has not yet been verified and upgraded to a full `doctor`.

In the hybrid RBAC model (ADR-0001 §1), the identity provider stores only a
small set of coarse v1 roles — `guest`, `doctor_guest`, `doctor`,
`legacy_admin`, `platform_admin` — while fine-grained, object-level permissions
live in the backend. `doctor_guest` is the self-service tier of that set.

Key properties:

- Every authenticated principal produced by feature 003 is a `doctor_guest`.
  It is materialised as a **domain user mirror** row in the backend `users`
  table, keyed by UUID, and authorised through a Zitadel project-role grant of
  `doctor_guest` (003-design §3) — the OIDC roles claim, not the mirror's
  `role` column, is the authorisation source of truth.
- It carries **no MFA mandate** (ADR-0001 §4). The session still ships the
  `mfa` claim as a seam, but no `doctor_guest` flow requires step-up.
- It exposes no high-risk endpoints in v1; the elevated-session / step-up
  machinery (ADR-0001 §10) is dormant until a role that needs it arrives.

**Related terms:** domain user mirror, consent gate, enumeration resistance.

**Sources:** ADR-0001 §1, §4 (`apps/docs/content/adr/0001-identity-provider-shortlist-en.md`);
feature 003 requirements + design (`apps/docs/content/specs/features/003-user-authentication/`).

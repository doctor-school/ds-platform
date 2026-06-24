---
title: "domain user mirror"
description: "The backend users row that projects a Zitadel identity into the domain — the UserMirror produced and reconciled by the auth feature."
lang: en
---

# domain user mirror (UserMirror)

**Bounded context:** identity · **Canonical id:** `user_mirror`

The **domain user mirror** is the backend `users` row that projects an identity
owned by the identity provider (Zitadel) into the platform's own domain. The
identity provider owns credentials, sessions, and tokens; the backend
(`apps/api`, a Backend-for-Frontend) owns the mirror, plus consent, RBAC role
grant, audit, and abuse guards (003-design §5). The mirror exists so the domain
can reference a stable, UUID-keyed user without reaching into the identity
provider on every request.

A `UserMirror` row carries: `id` (UUID primary key), `zitadel_sub` (exactly one,
linking to the identity-provider subject), optional `email` and `phone`,
`email_verified` / `phone_verified` flags, `role` (`doctor_guest` in v1), and
timestamps. The invariant `phone OR email NOT NULL` (ADR-0001 §3) always holds —
registration is email-primary because the identity provider cannot create a
login-capable human without an email, so every row carries an email.

Synchronisation:

- On registration the BFF performs an **inline upsert** so the mirror exists
  immediately, then a **Zitadel Action webhook** (`user.created` / updated) is
  the authoritative sync trigger that reconciles the row (003-requirements
  EARS-19).
- A periodic **reconciliation sweep** closes any divergence from a missed
  webhook (eventual consistency).
- The `role` column is a **downstream projection only** — it must never be read
  for authorisation; the identity provider's granted-roles claim is the
  authority (003-design §4).

**Related terms:** doctor_guest, consent gate, enumeration resistance.

**Sources:** feature 003 design §5 + requirements EARS-19
(`apps/docs/content/specs/features/003-user-authentication/`); ADR-0001 §3.

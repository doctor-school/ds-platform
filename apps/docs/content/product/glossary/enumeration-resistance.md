---
title: "enumeration resistance"
description: "Returning identical responses for existing vs unknown identifiers on auth surfaces, so an attacker cannot probe which accounts exist."
lang: en
---

# enumeration resistance

**Bounded context:** identity · **Canonical id:** `enumeration_resistance`

**Enumeration resistance** means an auth surface returns **identical responses
for an existing identifier and an unknown one**, so an attacker cannot use the
register / login / reset forms to probe which accounts exist. On a medical
platform the mere fact that an email or phone belongs to a registered doctor is
itself sensitive, so this is a v1 security-baseline requirement (ADR-0001 §7).

The contract (003-requirements EARS-16): register, login, and reset responses
are **idempotent and indistinguishable** between the existing-account and
unknown-account paths — same status, same body, and a **timing delta ≤ 50 ms**
between the two paths so latency cannot become a side-channel oracle.

How feature 003 upholds it:

- A registration on an **already-registered** email creates no account, consent,
  or audit row and returns the same `pending_verification` response as a fresh
  registration. The legitimate owner is reached **privately, out of band** — a
  fire-and-forget, per-address-throttled _account-exists notice_ email that
  carries no code or token and never alters the API response (EARS-23).
- The post-registration screen is **existence-agnostic** — it never branches on
  whether the account already existed (EARS-24).
- Login and password-reset failures return a **generic** error and never reveal
  whether the identifier exists (EARS-5, EARS-11).
- A deterministic identity-provider rejection is mapped to a generic,
  enumeration-safe failure — **never a bare 500** that could act as an oracle
  (003-design §4).

Rate limiting and a patched, enumeration-hardened identity-provider version are
the defence-in-depth backstop behind these idempotent responses (ADR-0001 §7;
003-requirements Constraints).

**Related terms:** doctor_guest, consent gate.

**Sources:** ADR-0001 §7
(`apps/docs/content/adr/0001-identity-provider-shortlist-en.md`); feature 003
requirements EARS-16/23/24 + design §4
(`apps/docs/content/specs/features/003-user-authentication/`).

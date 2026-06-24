---
title: "consent gate"
description: "The registration-time rule that no personal-data row is created before the registrant's per-purpose, versioned consent is recorded."
lang: en
---

# consent gate (per-purpose versioned consent)

**Bounded context:** compliance · **Canonical id:** `consent_gate`

The **consent gate** is the rule that **no personal-data (PD) row is committed
before the registrant's consent has been recorded**. At registration the system
captures the per-purpose, versioned consent the registrant accepted, and refuses
to activate the PD-bearing user mirror if that consent is absent
(003-requirements EARS-20; 003-design §4 — "PD activation gated on consent").

Consent is **per-purpose**, not all-in-one (ADR-0009 §2.1). Each purpose has its
own version stream, because under 152-FZ consent must be specific, informed, and
conscious, and **a user who agreed to v1 has not agreed to v2** — consent
versioning is mandatory. The pre-pilot purposes are:

- `tos` — terms of service + privacy notice (mandatory at signup);
- `medical_data_processing` — processing of special-category medical PD
  (mandatory to register as a doctor);
- `marketing_communications` — promotional channels (opt-in, not required).

Each accepted act is stored as an **append-only** record (no UPDATE / DELETE),
so there is durable proof that consent existed at a point in time (ADR-0009 §2.1).

Scope in v1: feature 003 ships a **minimal capture slice** — a `consent_records`
table recording the per-purpose versions accepted at registration. The full
consent subsystem (withdrawal, version migration, consent audit) is owned by the
ADR-0009 vertical; 003 references it, it does not own it (003-design §5).

**Related terms:** doctor_guest, domain user mirror.

**Sources:** ADR-0009 §2.1 and design §2.1
(`apps/docs/content/adr/0009-pd-lifecycle-and-consent-en.md`); feature 003
requirements EARS-20 + design §4–§5.

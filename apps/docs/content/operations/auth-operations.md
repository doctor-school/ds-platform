---
title: "Auth operations runbook (Zitadel webhook + reconciliation sweep)"
description: "Operating the BFF↔Zitadel identity-sync surfaces: the Action webhook and its shared-secret auth + rotation, the periodic reconciliation sweep and its manual trigger, fail-closed behaviour, and the EARS-18 audit trail."
lang: en
---

# Auth operations runbook

How to operate the two BFF surfaces that keep the domain user mirror
(`users` table, `doctor_guest` grant — 003-design §5) consistent with Zitadel:
the **Action webhook** (the primary, authoritative sync trigger) and the
**reconciliation sweep** (the eventual-consistency backstop). This is the first
runbook in `operations/`; it closes the #119 decision-debt surfaced during 003
F1 (#85).

Canon: [003 user-authentication design](../specs/features/003-user-authentication/003-design.md)
§5 (mirror), §7 (seams), §11 (webhook-auth decision + the #119 hardening list);
ADR-0001 (auth architecture); the
[engineering-readiness spec](../specs/tech/2026-05-12-engineering-readiness-design-en.md)
(Vault, Caddy, the trusted-zone topology).

Roles referenced are **roles, not names** (AGENTS.md §7): the **Tech Lead /
System Architect** owns the IdP/infra config in Phase 0.

## The two sync surfaces

| Surface              | Trigger                          | Role                                                   | EARS |
| -------------------- | -------------------------------- | ------------------------------------------------------ | ---- |
| Action webhook       | Zitadel `user.created`/`updated` | **Primary, authoritative** — mirror exists immediately | 19   |
| Reconciliation sweep | Periodic timer + manual trigger  | **Backstop** — closes a webhook-miss divergence        | 19   |

Both converge on the same idempotent upsert: a row keyed by `zitadel_sub` plus an
idempotent `doctor_guest` project-role grant (#157). The webhook is real-time and
authoritative; the sweep is the safety net for a missed or failed webhook
delivery. Neither path is a credential authority — Zitadel owns the credential,
the BFF owns only the downstream projection (003-design §2).

## Webhook authentication

The webhook endpoint is `POST /v1/auth/zitadel/webhook` — an externally-reachable
endpoint that upserts the mirror. It authenticates Zitadel with a **shared
secret** (003-design §11, decided — mTLS rejected for v1):

- Zitadel's Action presents the secret in the **`x-zitadel-webhook-secret`**
  header (a configurable static header on the Action target — the documented
  Zitadel Actions v2 mechanism).
- The BFF checks it against the **`IDP_WEBHOOK_SECRET`** environment value.
- The comparison is **constant-time** (`crypto.timingSafeEqual`, #119) — a naive
  string compare leaks timing proportional to the matching prefix, a side-channel
  that recovers the secret byte-by-byte. The compare returns `false` (never
  throws) on a length mismatch, so the secret length is not an oracle either.

### Fail-closed behaviour

The webhook **fails closed**: an **unset** `IDP_WEBHOOK_SECRET`, a **missing**
header, or a **mismatch** all return `401` and write nothing. An unauthenticated
mirror-write surface is never opened by default — if the secret is not
configured, the webhook rejects every call rather than accepting all of them. The
sweep (below) is the recovery path while the webhook is unconfigured or failing.

### Secret rotation (Vault-backed — target procedure)

> **Deferred dependency (#119 (a)).** Vault is **not yet deployed** in Phase 0
> (engineering-readiness spec). Until it is, `IDP_WEBHOOK_SECRET` is a
> per-environment value injected via the deployment's env/secret mechanism, and
> rotation is the manual two-step below performed by the **Tech Lead**. The
> Vault-backed automation is the target state, tracked as a named deferral (see
> [Open deferrals](#open-deferrals)).

Rotation must be **zero-downtime** because the webhook authenticates every
`user.created`/`updated` delivery. The webhook compares against a single secret,
so rotate by **briefly tolerating both** at the edge, or accept a short window
where the sweep is the sync path:

1. Generate a new high-entropy secret in the platform secret store (Vault, target
   path e.g. `secret/ds-platform/<env>/idp-webhook-secret`).
2. Update the **Zitadel Action target header** to the new secret (Zitadel console
   → Actions) **and** the BFF's `IDP_WEBHOOK_SECRET`, then restart/redeploy the
   BFF so it reloads the value. The reconciliation sweep covers any webhook
   delivery that lands mid-rotation against the stale secret (it would 401, and
   the sweep then reconciles the missed user on its next pass).
3. Confirm post-rotation: trigger a test `user.update` in Zitadel and confirm a
   `200` from the webhook (or run a [manual sweep](#manual-trigger) and confirm
   the user count).

When Vault is live, steps 1–2 collapse into a Vault rotation + a templated env
refresh; the manual console edit of the Action header remains until Zitadel can
read the header from Vault directly.

### Trusted-zone binding (#119 (c) — deferred)

003-design §11 (c) calls for binding the Action to the trusted LAN/zone target so
the webhook is not internet-reachable. The BFF terminates TLS behind the platform
reverse proxy (Caddy, engineering-readiness spec); the network-level binding of
the live Action is provisioned with the real prod Zitadel instance and is a named
deferral below — there is no live prod Zitadel in Phase 0. On the dev-stand the
Action header is set to `IDP_WEBHOOK_SECRET` and the stand is a trusted LAN
endpoint (`.claude/rules/dev-stand.md` — LAN is a trusted zone).

## Reconciliation sweep

`ReconcileService.sweep()` enumerates every Zitadel user (`idp.listUsers()`) and
idempotently upserts each **human** identity into the mirror, re-asserting the
`doctor_guest` grant. It returns `{ reconciled: N }` — the count of human doctor
identities mirrored.

> **Machine/service accounts are skipped.** `listUsers()` enumerates _every_
> Zitadel user, including machine/service accounts (e.g. the BFF's own service
> user) that have neither email nor phone. The mirror models human doctor
> identities (003-design §5) and the DB enforces a `users_email_or_phone` CHECK
> constraint, so a row with neither identifier is not a `doctor_guest` candidate
> and is skipped — it is not counted in `reconciled` (#119, surfaced live the
> first time the sweep ran against real Zitadel).

### Schedule

The periodic sweep runs on a timer registered by `ReconcileScheduler` via
`@nestjs/schedule`. The interval is **config-driven**, never hardcoded:

| Env var                       | Default           | Meaning                                                            |
| ----------------------------- | ----------------- | ------------------------------------------------------------------ |
| `RECONCILE_SWEEP_INTERVAL_MS` | `900000` (15 min) | Period between sweeps, in ms. `0` **disables** the periodic sweep. |

The default is deliberately **conservative** (15 minutes): the sweep is a
webhook-miss backstop, not a real-time mirror, and `idp.listUsers()` is a full
enumeration that can be heavy on a large instance. Set a longer interval on a
large directory; set `0` where only the webhook + manual trigger should drive
sync (e.g. an environment driven by an external scheduler). The scheduler
**guards against overlap** — a tick that fires while a previous sweep is still
running is skipped, so a slow enumeration never stacks concurrent sweeps — and is
**fail-soft**: a thrown sweep is logged and the next tick retries; the backstop
never crashes the process.

### Manual trigger

Ops can run a sweep on demand. It is a **standalone-Nest CLI script**, not an
HTTP endpoint — the wave-1 admin session rides the shared 003 session without
mandatory `platform_admin` MFA (ADR-0004 staged model; hardening #718), so an
HTTP reconcile-trigger would open an under-authorized mirror-write surface
mirroring the webhook. The script boots an HTTP-less Nest application
context, runs one `sweep()`, prints `{ "reconciled": N }`, and exits non-zero on
failure:

```bash
# Inject the dev-stand env (no dotenv autoload) and run one sweep.
set -a; source ~/.ds-platform/.env.local; set +a
RECONCILE_SWEEP_INTERVAL_MS=0 pnpm --filter @ds/api reconcile:sweep
# → {"reconciled":99}
```

Setting `RECONCILE_SWEEP_INTERVAL_MS=0` for the one-shot run avoids registering a
stray periodic timer in the short-lived CLI context. Use the manual trigger to:
recover after a webhook outage, after rotating the webhook secret, or to confirm
mirror consistency. It is safe to run repeatedly — every upsert and grant is
idempotent.

### Reconciliation depth (current scope)

003 ships **webhook upsert + a simple sweep** (003-design §11). The sweep upserts
and re-grants; it does **not** yet do conflict resolution or soft-delete handling
(a user deleted in Zitadel is not removed from the mirror by the sweep). That
deeper eventual-consistency reconciliation is explicitly deferred (003-design
§11) and is out of scope for #119.

## Audit trail (EARS-18)

The durable `audit_ledger` (append-only, PD masked to `identifier_hash` —
ADR-0001 §7, ADR-0003 §6) records the EARS-18 auth event taxonomy. The canonical
wire ids (`auth.<class>.<event>`, reconciled in
`apps/api/src/auth/session/auth-audit.ledger.ts`) currently emitted are:

| Event                                        | When                                   |
| -------------------------------------------- | -------------------------------------- |
| `auth.register`                              | a registration completes               |
| `auth.account.verified`                      | an email/phone verification succeeds   |
| `auth.login.success` / `.failure`            | a password/OTP login outcome           |
| `auth.token.rotated`                         | a refresh-token rotation               |
| `auth.token.theft_detected`                  | a refresh-token reuse (RFC-6819)       |
| `auth.session.terminated`                    | logout / global revoke                 |
| `auth.password.reset_requested` / `.changed` | a reset is initiated / completed       |
| `auth.lockout.triggered`                     | the native Zitadel lockout is observed |

**The webhook and the reconciliation sweep do not currently emit an audit row.**
Their effect is the idempotent mirror upsert + grant, observable in the `users`
table and the structured application logs (the scheduler logs each sweep's
`reconciled` count; the CLI prints it). This reflects the **real current state** —
EARS-18's taxonomy is scoped to the credential/session lifecycle, not the mirror
projection. If a future requirement adds a reconcile audit event (e.g.
`auth.account.reconciled`), it threads through the same `AuthAuditLog` port; until
then, do not assume a ledger row exists for a sweep.

## Failure modes

| Symptom                                   | Check / action                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Webhook returns `401`                     | Confirm `IDP_WEBHOOK_SECRET` is set on the BFF **and** matches the Zitadel Action target header. Unset ⇒ fail-closed by design.                                                                              |
| New Zitadel users not appearing in mirror | Webhook delivery failing — run a [manual sweep](#manual-trigger) to recover, then fix the Action/secret.                                                                                                     |
| Manual sweep fails on a DB CHECK error    | A user with neither email nor phone reached the upsert. Expected machine accounts are skipped (#119); if a _human_ row fails, inspect the `users_email_or_phone` constraint and the offending `zitadel_sub`. |
| Sweep "skipped this tick" warnings        | A sweep is outlasting the interval — raise `RECONCILE_SWEEP_INTERVAL_MS` or investigate `listUsers()` latency.                                                                                               |
| Periodic sweep not running                | Confirm `RECONCILE_SWEEP_INTERVAL_MS` is not `0`; check the BFF boot logs for "reconcile sweep scheduled".                                                                                                   |

Dev-stand pre-flight and recovery (the stand is power-cycled, not 24/7):
`.claude/rules/dev-stand.md`.

## Open deferrals

Tracked so no surface stands in silently for missing live infra (AGENTS.md §6
"no untracked seam"):

- **(a) Vault-backed secret rotation** — Vault is not deployed in Phase 0; the
  rotation procedure above is the documented target, performed manually until
  Vault lands (engineering-readiness spec).
- **(c) Live-Action provisioning + trusted-zone binding** — there is no live prod
  Zitadel in Phase 0; provisioning the real Action (header + network binding)
  against a live instance is deferred to the prod IdP bring-up. On the dev-stand
  the Action header is wired to `IDP_WEBHOOK_SECRET`.
- **Deeper reconciliation** — conflict resolution + soft-delete handling beyond
  the simple upsert sweep (003-design §11).

# Load-test harness (`tools/loadtest/`)

Prod load-testing campaign for the webinar room and adjacent surfaces (Issue
#873). **Phase 1 (this harness): build + smoke against the local dev stand only.
Phase 2 (a separate, owner-windowed run) is where prod is ever targeted** — and
even then only under the guards below. Nothing here runs against prod on its own.

## Runner: pure-Node (chosen) vs k6 (rejected)

**Chosen: a zero-dependency, Node-native harness.** Every scenario is a plain
`.mjs` run by the repo's existing `node`/`tsx` toolchain, using Node's built-in
`fetch` and global `WebSocket` (Node ≥22 — the repo's `engines.node`). No install
step, no new lockfile entry, no external binary.

**Rationale (recon fact 6):** the `tools/` convention is flat, env-driven
`node tools/<dir>/<file>.mjs` scripts (`tools/deploy/smoke-prod.mjs` is the
sibling template). k6 is an external binary whose scripts run in its own **goja**
runtime — it cannot import this repo's modules, cannot reuse the Zitadel v2
search+DELETE cleanup precedent, cannot read `LOADTEST_*`/`.env.local` the way the
rest of `tools/` does, and adds an install prerequisite to every operator's box.
The realtime scenario needs a **Centrifugo-protocol** WS client (connect-frame +
token channels-claim, server ping/pong), which is a thin hand-rolled client
either way; Node's `WebSocket` gives it to us in-toolchain. k6's edge —
distributed multi-node generation — is not needed for the single-box, low-hundreds
-VU capacity questions #873 asks, and single-source bursts hit the rate limiter
before capacity anyway (see auth-burst). If a future campaign needs true
multi-node distributed generation, revisit k6 then.

**Install:** none. Requires Node ≥22 (`node --version`). That's it.

## Configuration — everything is env-driven (no hardcoded hosts)

No scenario has a default host. `LOADTEST_API_ORIGIN` unset is a hard error, never
a silent fallback to prod.

| Env var                          | Scenarios                | Meaning                                                                     |
| -------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `LOADTEST_API_ORIGIN`            | all                      | api origin, no trailing `/v1` (e.g. `http://localhost:3000`). **Required.** |
| `LOADTEST_VUS`                   | load                     | concurrent virtual users                                                    |
| `LOADTEST_DURATION_SECONDS`      | load                     | steady-state duration                                                       |
| `LOADTEST_RAMP_SECONDS`          | load                     | ramp-up window (VU starts staggered across it)                              |
| `LOADTEST_P95_MS`                | load                     | p95 latency threshold — exceed ⇒ FAIL exit 1 (unset ⇒ report-only)          |
| `LOADTEST_ERROR_RATE`            | load                     | max error rate (0–1) — exceed ⇒ FAIL (unset ⇒ report-only)                  |
| `LOADTEST_EVENT_ID`              | room, browse             | live event id/slug (room grant target; browse event-page)                   |
| `LOADTEST_CHAT_FRACTION`         | room                     | fraction of VUs that POST chat (default 0.1)                                |
| `LOADTEST_USE_PROVISIONED`       | room, auth               | `1` ⇒ use the provision manifest instead of registering                     |
| `LOADTEST_SUPPRESSION_CONFIRMED` | auth                     | `1` unlocks auth-burst against a prod host (see guard)                      |
| `LOADTEST_IDP_ISSUER`            | provision, cleanup       | Zitadel issuer base URL                                                     |
| `LOADTEST_IDP_SERVICE_TOKEN`     | provision, cleanup       | org-owner PAT                                                               |
| `LOADTEST_IDP_ORG_ID`            | provision                | org id (else resolved via `orgs/me`)                                        |
| `LOADTEST_SYNTHETIC_DOMAIN`      | provision, cleanup, auth | reserved domain (default `loadtest.invalid`)                                |
| `LOADTEST_AUTH_PASSWORD`         | provision, auth, room    | synthetic-account password                                                  |
| `LOADTEST_USERS`                 | provision                | how many accounts to create                                                 |
| `LOADTEST_MANIFEST`              | provision, cleanup, …    | manifest path (default `tools/loadtest/.synthetic-users.json`, gitignored)  |

Read local-stand values from `~/.ds-platform/.env.local` and map them onto
`LOADTEST_*` (e.g. `LOADTEST_IDP_ISSUER=$IDP_ISSUER`) — never hardcode.

## Scenarios

- **`loadtest:browse`** — public, cacheable event reads (`/v1/public/events`,
  `?month=`, `month-counts`, event page). No auth, no mutation — safe anywhere.
- **`loadtest:auth`** — register→login (or login-only with
  `LOADTEST_USE_PROVISIONED=1`). Fail-closed prod guard (below). `429`/`403`/`401`
  are the limiter/bot/bad-cred wall — reported, not counted as capacity errors.
- **`loadtest:room`** — the webinar-room fan-out: grant → Centrifugo WS connect →
  heartbeat → server-mediated chat. Needs the room fixture (below).
- **`loadtest:provision` / `loadtest:cleanup`** — synthetic-account lifecycle,
  direct against Zitadel v2 (never the bot-gated BFF register). Accounts are born
  **verified** (`email.isVerified`) so **no email/SMS is ever dispatched** for
  them — the delivery-suppression seam for synthetic users. Cleanup is the v2
  search+DELETE precedent (`apps/api/test/auth/zitadel-create-user.e2e-spec.ts`);
  `LOADTEST_CLEANUP_SWEEP=1` additionally reaps every `@<domain>` account.

### auth-burst prod guard (fail-closed, #1068)

`auth-burst` **refuses** to run against a `doctor.school` host until
`LOADTEST_SUPPRESSION_CONFIRMED=1`. Two reasons, both phase-2 owner decisions:

1. **Delivery.** No per-user delivery-suppression seam exists yet (recon fact 3);
   synthetic register/verify traffic to prod can dispatch **real** verification
   emails. Tracked as **#1068** — do not set the flag until that seam is in place.
2. **Rate limits.** Per-IP 20/15min + per-ASN 100/h (recon fact 2) mean a
   single-source prod burst measures the **limiter**, not capacity. Treatment
   (distributed sources, or an owner-approved windowed threshold change — never a
   code flag flip) is a phase-2 decision.

## Run protocol (phase 2 — owner-windowed prod run)

### Pre-run checklist

- [ ] **Owner window recorded** — explicit start/end, on a low-traffic window; a
      live medical platform, real doctors mid-webinar are the blast radius.
- [ ] **#1068 resolved** for any prod auth traffic (suppression seam + rate-limit
      treatment); otherwise run room/browse only, skip auth-burst.
- [ ] **Who watches what** assigned: api error rate (GlitchTip), latency/logs
      (Loki/Grafana), Centrifugo + box CPU/mem (see gap list).
- [ ] Abort criteria + thresholds agreed and pasted into the run doc.
- [ ] Synthetic accounts provisioned (`loadtest:provision`) + roster-joined to the
      target event; cleanup command staged.
- [ ] Start small: 1 VU sanity, then ramp.

### Abort criteria (template — fill per run)

Stop the generators immediately if **any** holds for >~30s:

| Signal                      | Abort threshold (fill in) |
| --------------------------- | ------------------------- |
| api p95 latency             | > ____ ms                 |
| api error rate (5xx)        | > ____ %                  |
| box CPU                     | > ____ %                  |
| box memory                  | > ____ %                  |
| Centrifugo connect failures | > ____ %                  |
| any real-user report        | any                       |

### Abort / rollback

The load test **mutates no schema and writes no migration** — abort is simply:
(1) Ctrl-C every generator (kill by port/PID — the harness opens only outbound
connections, no listeners), (2) `pnpm loadtest:cleanup` (add
`LOADTEST_CLEANUP_SWEEP=1` for belt-and-braces) to delete synthetic accounts and
any presence/chat rows they created age out on their own. No data rollback needed.

## Observability pre-flight (recon fact 5)

| Signal                          | Status                                                                  | Watch at                    |
| ------------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| api error tracking              | **Wired** — GlitchTip (self-hosted, Sentry-API)                         | obs.doctor.school (VPN/IdP) |
| api logs / latency / error-rate | **Wired** (minimal) — Loki + Grafana                                    | obs.doctor.school           |
| RED metrics                     | **Wired** — Prometheus + Grafana (e.g. `bff_mailer_relay_events_total`) | obs.doctor.school           |
| distributed tracing             | **Deferred** — Tempo is pilot-phase, not wired                          | —                           |
| **Centrifugo stats/metrics**    | **NOT confirmed wired**                                                 | gap — see below             |
| **box CPU / mem**               | **NOT confirmed in repo** (likely Timeweb console only)                 | gap — see below             |

### Gaps phase 2 must close before a prod run

- **Centrifugo telemetry.** The room scenario is the headline load; without
  Centrifugo connection/subscription/publish metrics scraped into
  Prometheus/Grafana the run is half-blind on its primary target. Confirm or wire
  a minimal Centrifugo `/metrics` scrape before the room run.
- **Box CPU/mem.** No repo-visible dashboard; confirm the Timeweb console (or a
  node-exporter scrape) is watchable live and assign a watcher, or the CPU/mem
  abort thresholds above are unenforceable.

Fill these two, or scope phase 2 to what is observable.

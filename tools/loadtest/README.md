# Load-test harness (`tools/loadtest/`)

Two related webinar-room tools live here: the #873 capacity/load campaign and
the #1139 low-N behavioral verifier. **The behavioral verifier targets the local
dev stand only. The capacity scenarios run against the dev stand by default;
production is targeted only in the owner-approved run window of #873 phase 2**,
and even then only through the explicit per-scenario confirmations below.
Nothing here runs against production on its own, and `stage.doctor.school` is
never a target (the tripwire treats it as production).

## Runner: pure-Node (chosen) vs k6 (rejected)

**Chosen: a zero-dependency, Node-native harness.** Every scenario is a plain
`.mjs` run by the repo's existing `node`/`tsx` toolchain, using Node's built-in
`fetch` and global `WebSocket` (the repo's Node contract). No install
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

**Install:** none. Requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`
(`node --version`), exactly the root `engines.node` contract. That's it.

## Configuration — everything is env-driven (no hardcoded hosts)

No scenario has a default host. A required target variable left unset is a hard
error, never a silent fallback to prod.

| Env var                                | Scenarios                | Meaning                                                                                                                                     |
| -------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOADTEST_API_ORIGIN`                  | all                      | api origin, no trailing `/v1` (e.g. `http://localhost:3000`). **Required.**                                                                 |
| `LOADTEST_STOREFRONT_ORIGIN`           | auth, room               | set ⇒ the storefront sign-in transport: the storefront's `/login` door and `/auth/callback` mint the session. **Required for production.**  |
| `LOADTEST_INTERNAL_API_TOKEN`          | auth, room               | the internal sign-in transport (storefront origin unset, stand only): the storefront servers' `INTERNAL_API_TOKEN` for transaction + redeem |
| `LOADTEST_NON_PROD_IPS`                | all tripwires            | comma-separated exact IP literals the operator vouches are non-production (e.g. the stand's LAN address); no ranges, no names               |
| `LOADTEST_ROOM_PROD_CONFIRMED`         | room                     | `1` unlocks room-fanout against a production target (see «Production tripwires»)                                                            |
| `LOADTEST_SIGN_IN_HOST_ORIGIN`         | auth, room               | the sign-in host origin (`IDP_SIGN_IN_BASE_URI`); the host password step is a same-origin post of it. **Required.**                         |
| `LOADTEST_CENTRIFUGO_ORIGIN`           | room verify              | authoritative Centrifugo HTTP(S) origin; mapped from `CENTRIFUGO_URL`. **Required.**                                                        |
| `LOADTEST_VUS`                         | load                     | concurrent virtual users                                                                                                                    |
| `LOADTEST_DURATION_SECONDS`            | load                     | steady-state duration                                                                                                                       |
| `LOADTEST_RAMP_SECONDS`                | load                     | ramp-up window (VU starts staggered across it)                                                                                              |
| `LOADTEST_P95_MS`                      | load                     | p95 latency threshold — exceed ⇒ FAIL exit 1 (unset ⇒ report-only)                                                                          |
| `LOADTEST_ERROR_RATE`                  | load                     | max error rate (0–1) — exceed ⇒ FAIL (unset ⇒ report-only)                                                                                  |
| `LOADTEST_EVENT_ID`                    | room, browse             | live event id/slug (room grant target; browse event-page)                                                                                   |
| `LOADTEST_CHAT_FRACTION`               | room                     | fraction of VUs that POST chat (default 0.1)                                                                                                |
| `LOADTEST_USE_PROVISIONED`             | room, auth               | `1` ⇒ use the provision manifest instead of registering                                                                                     |
| `LOADTEST_SUPPRESSION_CONFIRMED`       | auth                     | `1` unlocks auth-burst against a production target (see «Production tripwires»)                                                             |
| `LOADTEST_IDP_ISSUER`                  | provision, cleanup       | Zitadel issuer base URL                                                                                                                     |
| `LOADTEST_IDP_SERVICE_TOKEN`           | provision, cleanup       | org-owner PAT                                                                                                                               |
| `LOADTEST_IDP_ORG_ID`                  | provision                | org id (else resolved via `orgs/me`)                                                                                                        |
| `LOADTEST_IDP_PROJECT_ID`              | provision                | Zitadel project that owns `doctor_guest`; required so login gets the real role claim                                                        |
| `LOADTEST_SYNTHETIC_DOMAIN`            | provision, cleanup, auth | reserved domain (default `loadtest.invalid`)                                                                                                |
| `LOADTEST_AUTH_PASSWORD`               | provision, auth, room    | synthetic-account password                                                                                                                  |
| `LOADTEST_USERS`                       | provision                | how many accounts to create                                                                                                                 |
| `LOADTEST_MANIFEST`                    | provision, cleanup, …    | manifest path (default `tools/loadtest/.synthetic-users.json`, gitignored)                                                                  |
| `LOADTEST_BEHAVIOR_PUBLISH_GRACE_MS`   | room verify              | fresh +1 / age-out −1 publication budget (default `1000`)                                                                                   |
| `LOADTEST_BEHAVIOR_COMMAND_TIMEOUT_MS` | room verify              | transport/setup command timeout (default `10000`)                                                                                           |

Read local-stand values from `~/.ds-platform/.env.local` and map them onto
`LOADTEST_*` (e.g. `LOADTEST_IDP_ISSUER=$IDP_ISSUER`) — never hardcode.

## Targets — the current production topology

All production vhosts sit on one box behind Caddy
(`infra/deploy/compose/api-prod/Caddyfile`); every one of them answers `404` for
`/v1/internal/*` (`internal_api_unreachable`). A run in the window maps:

| Role                 | Production origin             | Harness env                                                          |
| -------------------- | ----------------------------- | -------------------------------------------------------------------- |
| api (BFF) + realtime | `https://api.doctor.school`   | `LOADTEST_API_ORIGIN`; the room grant names `…/connection/websocket` |
| doctor storefront    | `https://new.doctor.school`   | `LOADTEST_STOREFRONT_ORIGIN` (the webinar audience's storefront)     |
| sign-in host         | `https://login.doctor.school` | `LOADTEST_SIGN_IN_HOST_ORIGIN`                                       |
| IdP (Zitadel)        | `https://id.doctor.school`    | `LOADTEST_IDP_ISSUER` (provision / cleanup only)                     |

**Sign-in is the production journey** (ADR-0015 §4, 003 EARS-5/61/62/64): the
storefront door `GET /login` opened as a document (303 to the IdP authorize URL
plus the transaction cookie) → the authorize hop (its `Location` names the auth
request) → `GET /v1/sign-in-host/entry` → the password step
`POST /v1/sign-in-host/login` → the callback URL it answers, which the
storefront server redeems into the `__Host-ds_session` cookie. Every step is a
sample. The **storefront** transport (`LOADTEST_STOREFRONT_ORIGIN` set) drives
exactly that and calls nothing internal; it is the only transport that works
against production, and the harness refuses the other one for a production
target. The **internal** transport (unset) makes the storefront server's own
calls, `POST /v1/internal/oidc/transaction` and `/redeem` with
`LOADTEST_INTERNAL_API_TOKEN`, on an api reached directly — the dev stand,
where no storefront server needs to run. The synthetic accounts sign in with
the password step (provisioned with a password and a verified address); one
six-digit email code serves every code step since the 003 «one email code»
amendment, and no scenario drives a code step.

The room, heartbeat and chat calls go to `LOADTEST_API_ORIGIN`. Doctors'
browsers reach the same `/v1/*` paths through the doctor storefront's
same-origin proxy: `LOADTEST_API_ORIGIN=https://new.doctor.school` puts the
storefront server's proxy hop into the measured path,
`https://api.doctor.school` measures the api alone — record which one a run
used.

## Scenarios

- **`loadtest:browse`** — public, cacheable event reads (`/v1/public/events`,
  `?month=`, `month-counts`, event page). No auth, no mutation — safe anywhere.
- **`loadtest:auth`** — the Academy register command `POST /v1/auth/register`,
  then the sign-in journey (or sign-in only with `LOADTEST_USE_PROVISIONED=1`,
  the way to measure sign-in capacity). Fail-closed production tripwire (below).
  `429`/`403`/`401` are the limiter/bot/bad-cred wall — reported, not counted as
  capacity errors.
- **`loadtest:room`** — the webinar-room fan-out: each account signs in once and
  joins the event roster once (`POST /v1/events/:id/registration`, idempotent);
  every iteration then takes the grant → Centrifugo WS connect → heartbeat →
  server-mediated chat (a `LOADTEST_CHAT_FRACTION` of VUs). Needs a live event
  and `LOADTEST_USE_PROVISIONED=1`. Fail-closed production tripwire (below).
- **`loadtest:room:verify`** — the #1139 two-doctor, low-N behavioral proof:
  fresh join/age-out timing, chat reconnect/history continuity, and an intentional
  failed-heartbeat diagnostic. It is a deterministic Stage-B artifact generator,
  **not** a capacity test and **not** a CI test; it hard-refuses production.
- **`loadtest:provision` / `loadtest:cleanup`** — synthetic-account lifecycle,
  direct against Zitadel v2 (never the bot-gated BFF register). Accounts are born
  **verified** (`email.isVerified`) so **no email/SMS is ever dispatched** for
  them — the delivery-suppression seam for synthetic users — and provisioning
  idempotently grants the real `doctor_guest` project role **before login**, so the
  BFF session contains the authority required by the registration/room gates.
  Cleanup is the v2
  search+DELETE precedent (`apps/api/test/auth/zitadel-create-user.e2e-spec.ts`);
  `LOADTEST_CLEANUP_SWEEP=1` additionally reaps every `@<domain>` account.

### Low-N room behavior proof (#1139, dev stand only)

Prerequisites:

- map the stand's `API_ORIGIN`, `CENTRIFUGO_URL`, `IDP_ISSUER`, `IDP_PROJECT_ID`,
  and related IdP values from `~/.ds-platform/.env.local` to the corresponding
  `LOADTEST_*` vars, including `LOADTEST_CENTRIFUGO_ORIGIN=$CENTRIFUGO_URL`;
- designate a real event with `LOADTEST_EVENT_ID`; it must already be `live`, and
  Centrifugo must be configured;
- run `LOADTEST_USERS=2 pnpm loadtest:provision` (or use a manifest containing at
  least two distinct, provisioned doctors). Provisioning creates verified humans
  and grants `doctor_guest`; the verifier logs both in through the real BFF;
- use a quiescent room/fresh participant. The verifier idempotently registers each
  doctor through the real `POST /v1/events/:idOrSlug/registration` command — never
  by a DB write or manual roster join. A repeated run can find the participant
  still fresh; if so it exits `SETUP ERROR` and tells the operator to wait the full
  `2 × N` after that newly accepted beat or provision fresh accounts.

Run exactly one command:

```sh
LOADTEST_CENTRIFUGO_ORIGIN="$CENTRIFUGO_URL" pnpm loadtest:room:verify
```

The owner-readable stdout starts with a UTC run timestamp and records the API
target, derived Centrifugo WebSocket target, event, N, each check, measured
timing, and the final verdict without credentials or doctor PII. Paste the
complete report into the Issue/PR and link that artifact from the Stage-B record.
The verifier's direct assertions are deliberately bounded:

- a fresh doctor (not already inside the live-count freshness window) produces
  `+1`, published within about one second after the accepted entry/re-entry beat;
- stopping that doctor's beats ages the doctor out no later than `2 × N` after the
  last accepted beat, then publishes `-1` within about one second;
- separately, the forced chat reconnect/history-continuity story and the
  intentional failed-heartbeat diagnostic are direct checks in the same report.

The following bullets are settled surrounding room contract, not additional
assertions by this harness; component/runtime tests and the feature spec cover
them:

- WebSocket close alone is not leave;
- quick re-entry/concurrent tabs while already fresh coalesce and require no
  count-change publication;
- `2 × N` is live distinct-count freshness grace only. Sponsor minutes remain the
  distinct accepted-beat N-bucket derivation; the grace awards no trailing time;
- a hidden tab emits no beats, returning visible emits one immediately, and a
  still-visible foreground tab cannot prove that the person has physically left.

The REST target remains loopback-only: `LOADTEST_API_ORIGIN` accepts `localhost`,
`127.0.0.1`, or `[::1]` (with trailing-dot normalization). Realtime may live on a
non-production recipe host or IP, so the verifier requires the operator to map
the stand's authoritative `CENTRIFUGO_URL` to `LOADTEST_CENTRIFUGO_ORIGIN`. That
value must be a bare HTTP(S) origin; `doctor.school` production hosts are
always refused, and so is any IP literal not listed in `LOADTEST_NON_PROD_IPS`
(the harness-wide rule below). The verifier derives the matching `ws:` or `wss:` URL on the
same host and port with the exact `/connection/websocket` path. Both initial
grants and the refreshed reconnect grant must match it after normalization.
Scheme, host, port, path, credentials, query, or fragment drift is refused
before any WebSocket connect. Every other origin the verifier requests is
refused when it is production, whatever confirmation is set: the storefront
door and the sign-in host (`LOADTEST_STOREFRONT_ORIGIN`,
`LOADTEST_SIGN_IN_HOST_ORIGIN`) before any request, and the IdP authorize hop
and the storefront callback a sign-in follows before each is requested
(«Production tripwires»).

### Production tripwires (fail-closed)

`lib.mjs` `isProdTarget` decides what counts as production, by name, and fails
closed:

- **every `doctor.school` name** — api, `login.`, `new.`, `academy.`, `id.` and
  the shared `stage.` slots — including the fully qualified spelling with a
  trailing root dot (`api.doctor.school.`), which DNS and TLS treat as the same
  host;
- **every IP literal** (IPv4, IPv6, IPv4-mapped, and the alternative IPv4
  spellings the URL parser canonicalises, such as `0x4de9dcde`) **unless
  `LOADTEST_NON_PROD_IPS` lists it exactly.** Why: all production vhosts answer
  on one box address, so a bare address reaches production with no
  `doctor.school` name to match, and an address's shape proves nothing (the dev
  stand is a private LAN address; a cloud network is private too). Only the
  operator can vouch for an address, one exact address at a time — a range or a
  name in the list is a hard error;
- **loopback (`127.0.0.0/8`, `::1`) is non-production**, exactly like
  `localhost`. A tunnel from a local port into production is invisible to any
  host check; tunnels are governed by the run protocol, not by this function.
  No DNS lookup happens either: a non-`doctor.school` name that resolves to the
  production box is the operator's configuration.

`lib.mjs` `productionGate` is the one gate of every guarded scenario, and it
checks **every origin the run requests**, not the api alone:

- **before any request** (and before the manifest is read): each of
  `LOADTEST_API_ORIGIN`, `LOADTEST_STOREFRONT_ORIGIN`,
  `LOADTEST_SIGN_IN_HOST_ORIGIN` and `LOADTEST_CENTRIFUGO_ORIGIN` that is set.
  A stand api with a production storefront left in the shell is a production
  run and refuses exactly like a production api;
- **before each request to a URL no env var names**: the IdP authorize hop and
  the storefront callback a sign-in follows, the WebSocket a room grant names.
  A server answer cannot route the run into production either. The refusal
  names the origin only, never a callback's code.

A production target is refused until the scenario's own confirmation is set —
to `1` exactly. One scenario's confirmation never unlocks another's gate:

| Scenario               | Confirmation                       | Why it is gated                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadtest:room`        | `LOADTEST_ROOM_PROD_CONFIRMED=1`   | loads the live realtime path real doctors are on; its chat leg posts messages every participant of the room sees — so only in the window, only against the dedicated synthetic event                                         |
| `loadtest:auth`        | `LOADTEST_SUPPRESSION_CONFIRMED=1` | register traffic dispatches real mail unless the api runs with `LOADTEST_SUPPRESS_SYNTHETIC=true` (the #1068 seam drops `LOADTEST_SYNTHETIC_DOMAIN` recipients before the relay); a single-source burst measures the limiter |
| `loadtest:room:verify` | none — refuses production always   | a Stage-B artifact generator for the dev stand                                                                                                                                                                               |
| sign-in (auth, room)   | — (transport rule)                 | the internal transport is refused for a production target: `/v1/internal/*` is `404` there. A sign-in outside a scenario's gate refuses production outright                                                                  |

`loadtest:browse` is read-only and ungated. `loadtest:provision` /
`loadtest:cleanup` act on the IdP named by `LOADTEST_IDP_ISSUER`, only on
`LOADTEST_SYNTHETIC_DOMAIN` accounts, and carry no confirmation: the
production org-owner PAT is their only gate.

### Rate limits a single-source run meets (003 EARS-13)

Per-IP windows as of the 003 amendment «auth rate limit behind one shared
address» (#2684) and the sign-in host roll-out
(`apps/api/src/auth/rate-limit/rate-limit.types.ts`):

| Window                                                                        | Ceiling                                      | Env knob                               |
| ----------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- |
| per IP, verification doors — password step, `login/otp`, `verify`, reset done | 20 **failures** / 15 min (a success refunds) | `RATE_LIMIT_PER_IP_15MIN`              |
| per IP, sending doors — `register`, code request, resend, reset request       | 60 / 15 min                                  | `RATE_LIMIT_PER_IP_15MIN` (moves both) |
| per IP, storefront entry · sign-in host entry · storefront redeem (each)      | 1200 / 15 min                                | **none** — fixed scopes                |
| per user (identifier)                                                         | 10 / 15 min, forgiven on success             | `RATE_LIMIT_PER_USER_15MIN`            |
| per ASN (edge `x-asn`)                                                        | 100 / h                                      | `RATE_LIMIT_PER_ASN_1H`                |

From one source address every successful sign-in spends one unit of each
1200 / 15 min entry/redeem window, so **about 80 sign-ins per minute is the
single-source ceiling, and no env knob lifts it.** The recorded window
treatment (a temporary per-IP raise, owner decision 2026-07-17) lifts the
verification and sending doors only. That is why `loadtest:room` signs each
account in once and keeps the session — a room of N doctors costs N sign-ins,
not N per iteration. An `auth-burst` that must exceed ~80 sign-ins/min needs
distributed sources; that is a window-time decision, not a harness default.

### Rate-limit window recipe (#1076 — env override, not a code flag)

The EARS-13 ceilings are env-overridable per var so an **owner-approved window**
can raise them for the burst without touching code (ADR-0001 §7). Defaults stay
byte-identical when unset: per-user 10/15 min, per-IP 20 failed verifications
and 60 sends / 15 min (the one per-IP knob moves both), per-ASN 100/h. The fixed
1200 / 15 min entry/redeem scopes have no knob (table above).

| Env var (on the api process) | Overrides                   | Default     |
| ---------------------------- | --------------------------- | ----------- |
| `RATE_LIMIT_PER_USER_15MIN`  | per-user / 15 min           | `10`        |
| `RATE_LIMIT_PER_IP_15MIN`    | per-IP / 15 min, both doors | `20` / `60` |
| `RATE_LIMIT_PER_ASN_1H`      | per-ASN / hour              | `100`       |

Each must be a **positive integer**; a malformed / ≤0 / non-integer value is
ignored with a loud api-log warn and the default kept for that ceiling — the
limiter can never be disabled or set unlimited, and a typo never crashes api boot.

Procedure (only inside a recorded owner window):

1. **Set** the needed var(s) — and `LOADTEST_SUPPRESS_SYNTHETIC=true` for any
   auth traffic — in the api's env (prod `/etc/ds-platform/api.env`; local: the
   session env of the api process — never edit `~/.ds-platform/.env.local`).
2. **Restart** the api container/process so the module factory re-reads the env.
3. **Run** the burst (`loadtest:auth` with `LOADTEST_SUPPRESSION_CONFIRMED=1`,
   the api running with `LOADTEST_SUPPRESS_SYNTHETIC=true`).
4. **Revert (mandatory).** UNSET the var(s) and `LOADTEST_SUPPRESS_SYNTHETIC` and
   **restart** the api again to return to the byte-identical defaults. The revert is part of the
   Abort / rollback closeout below — a raised ceiling must never outlive the window.

## Run protocol (phase 2 — owner-windowed prod run)

### Dev-stand smoke (before the window, on the window's `main`)

Run it once on the commit the window will run, with both sign-in transports, at
≤ 3 VUs for seconds each.

**Where: the local dev stand, not a stage slot.** A stage slot is a
`stage.doctor.school` name, which the tripwire treats as production
(«Production tripwires»), so a slot run would need the window confirmations,
and those are set only in the window shell. The local stand runs the same
storefront door and callback (`@ds/auth-flow` `storefront-oidc`) and the same
api sign-in host the window drives, against the dev IdP, where the doctor
storefront client is already registered. The stand cannot show the production
edge: the Caddy vhosts and their `/v1/internal/*` `404`. The window's 1-VU
sanity (checklist) is therefore the first run through that edge.

**Stand.** Work in a worktree on that `main`, and log every stand command
(`.claude/rules/dev-stand.md` → Shared-stand discipline):

1. `pnpm dev:status`, then `pnpm dev:ports` for a free api port `<api>`
   (cross-check with `netstat -ano | findstr ":<api> "`). The doctor storefront
   gets no choice of port. The dev IdP registers exactly
   `http://localhost:3004/auth/callback` for its client
   (`IDP_DOCTOR_REDIRECT_URI`, `infra/dev-stand/idp/provision.sh` step 3.bis),
   and the api answers the password step with the callback of
   `SIGN_IN_DOCTOR_LOGIN_URL` (`http://localhost:3004/login`). A listener on
   `:3004` you did not start blocks rows 6–7: wait for it, never kill it.
2. `pnpm dev:db:branch 873`, then `pnpm --filter @ds/api seed:events` with the
   printed `DATABASE_URL` (it writes the live event `seed-005-live`).
3. **api.** Build it with `pnpm --filter "@ds/api..." build`, then run
   `node dist/main.js` in `apps/api`. Load `~/.ds-platform/.env.local` into the
   process env line by line, and add `PORT=<api>`, the branch `DATABASE_URL`,
   `ROOM_HEARTBEAT_INTERVAL_SECONDS=2`, and bot protection off (`UNLEASH_URL` and
   `UNLEASH_API_TOKEN` unset, `BOT_PROTECTION_ENABLED=false`). Record its PID.
4. **Doctor storefront** (rows 6–7 only). Load the same `.env.local`, then run
   `INTERNAL_API_URL=http://127.0.0.1:<api> API_PROXY_TARGET=http://127.0.0.1:<api> ACADEMY_PUBLIC_ORIGIN=http://localhost:3001 pnpm --filter @ds/doctor exec next dev -p 3004 -H 127.0.0.1`
   and record its PID. Every hop to the api must go over `127.0.0.1`. The
   session fingerprint binds the client's IP/24
   (`apps/api/src/auth/session/session.cookie.ts`), so a password step from
   `::1` with a redeem from `127.0.0.1` reads as foreign, and the callback then
   answers `303` with no session.

**Harness env** for every row. Map the values from `.env.local`; never type a
secret into a command line or a log:

```sh
LOADTEST_API_ORIGIN=http://127.0.0.1:<api>
LOADTEST_SIGN_IN_HOST_ORIGIN="$IDP_SIGN_IN_BASE_URI"   # the sign-in host, http://localhost:3005
LOADTEST_IDP_ISSUER="$IDP_ISSUER"
LOADTEST_IDP_SERVICE_TOKEN="$IDP_SERVICE_TOKEN"        # the stand's org-owner PAT
LOADTEST_IDP_PROJECT_ID="$IDP_PROJECT_ID"
LOADTEST_INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN"      # internal-transport rows
LOADTEST_CENTRIFUGO_ORIGIN="$CENTRIFUGO_URL"           # room:verify; checked by every tripwire
```

If the host of the stand's `CENTRIFUGO_URL` is an IP literal, also set
`LOADTEST_NON_PROD_IPS` to that one address. The room grant's WebSocket lives
on that host, and every tripwire refuses an IP literal that nobody has vouched
for. No confirmation env is set anywhere in the smoke.

**Rows**, in order. `LOADTEST_STOREFRONT_ORIGIN` stays unset (the internal
transport) unless the row sets it. The load rows (1 and 3–7) must end with
`VERDICT: PASS` and `err=0.0%`, and their `status:` line must have exactly the
shape below. The other rows state their own PASS:

| #   | Command                                                                                                                                                                       | PASS looks like                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `LOADTEST_VUS=3 LOADTEST_DURATION_SECONDS=5 LOADTEST_EVENT_ID=seed-005-live pnpm loadtest:browse`                                                                             | `200` only                                                                                                                                                                                                                                         |
| 2   | `LOADTEST_USERS=3 pnpm loadtest:provision`                                                                                                                                    | 3 usable accounts in the manifest                                                                                                                                                                                                                  |
| 3   | `LOADTEST_USE_PROVISIONED=1 LOADTEST_VUS=2 LOADTEST_DURATION_SECONDS=5 pnpm loadtest:auth`                                                                                    | `200` : `302` = 4 : 1. The transaction, host entry, password step and redeem answer `200`; the authorize hop answers `302`                                                                                                                         |
| 4   | `LOADTEST_VUS=2 LOADTEST_DURATION_SECONDS=4 pnpm loadtest:auth` (register + sign-in)                                                                                          | `200` : `302` = 5 : 1 (the register adds one `200`)                                                                                                                                                                                                |
| 5   | `LOADTEST_USE_PROVISIONED=1 LOADTEST_EVENT_ID=seed-005-live LOADTEST_VUS=3 LOADTEST_DURATION_SECONDS=8 LOADTEST_RAMP_SECONDS=1 LOADTEST_CHAT_FRACTION=0.5 pnpm loadtest:room` | `200` only, and no `fixture gap` line                                                                                                                                                                                                              |
| 6   | `LOADTEST_STOREFRONT_ORIGIN=http://localhost:3004 LOADTEST_USE_PROVISIONED=1 LOADTEST_VUS=1 LOADTEST_DURATION_SECONDS=5 pnpm loadtest:auth`                                   | `200` : `302` : `303` = 2 : 1 : 2. Per sign-in, the door and the callback answer `303`, the authorize hop `302`, and the host entry and the password step `200`. A `200`-only line means the door never opened; a `500` means unset storefront env |
| 7   | `LOADTEST_STOREFRONT_ORIGIN=http://localhost:3004 LOADTEST_USE_PROVISIONED=1 LOADTEST_EVENT_ID=seed-005-live LOADTEST_VUS=2 LOADTEST_DURATION_SECONDS=8 pnpm loadtest:room`   | `200` only, and no `fixture gap` line: the room gate accepted the sessions the storefront callback minted. A callback that sets no session still answers `303`, so row 6 alone cannot prove the session; this row does                             |
| 8   | `LOADTEST_EVENT_ID=seed-005-live pnpm loadtest:room:verify`                                                                                                                   | `VERDICT: PASS`, every check passed                                                                                                                                                                                                                |
| 9   | `LOADTEST_STOREFRONT_ORIGIN=http://192.0.2.1 pnpm loadtest:room`, then the same with `pnpm loadtest:auth`                                                                     | refused before any request (exit `3` / `2`): `REFUSING to run … against production target LOADTEST_STOREFRONT_ORIGIN`. The address is TEST-NET-1, so a broken guard could reach nothing                                                            |
| 10  | `LOADTEST_CLEANUP_SWEEP=1 pnpm loadtest:cleanup`                                                                                                                              | every synthetic account deleted, 0 left                                                                                                                                                                                                            |

Teardown: stop your api and storefront by their recorded PIDs, then run
`pnpm dev:db:drop 873`. Paste the ten outcomes into the window's run doc. A row
that misses its shape blocks the window until it is fixed and re-run.

### Pre-run checklist

- [ ] **Owner window recorded** — explicit start/end, on a low-traffic window; a
      live medical platform, real doctors mid-webinar are the blast radius.
- [ ] **Production runs this harness's contract** — the deployed release
      (`gh release list`, GitHub Deployments) carries the api/auth surface the
      harness drives, and the «Dev-stand smoke» above passed on the window's
      `main`, all ten rows including the storefront-transport rows 6–7.
- [ ] **Window env applied** for any auth traffic: `LOADTEST_SUPPRESS_SYNTHETIC=true`
      plus the per-IP raise on the api, restarted (window recipe above);
      otherwise run room/browse only and skip auth-burst.
- [ ] **Dedicated synthetic event** — a `live` event no real doctor is
      registered for, as `LOADTEST_EVENT_ID`; never a real эфир, since the chat
      leg posts into its room.
- [ ] **Targets mapped** per «Targets» (`LOADTEST_STOREFRONT_ORIGIN` set, the
      measured `LOADTEST_API_ORIGIN` recorded); the confirmations
      (`LOADTEST_ROOM_PROD_CONFIRMED=1`, `LOADTEST_SUPPRESSION_CONFIRMED=1`) set
      only in the window shell.
- [ ] **Who watches what** assigned: api error rate (GlitchTip), latency/logs
      (Loki/Grafana), Centrifugo + box CPU/mem (see gap list).
- [ ] Abort criteria + thresholds agreed and pasted into the run doc.
- [ ] Synthetic accounts provisioned (`loadtest:provision`; `loadtest:room`
      joins each to the roster itself); cleanup command staged.
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
any presence/chat rows they created age out on their own, (3) if any
`RATE_LIMIT_PER_*` window override was set, **unset it and restart the api** to
restore the byte-identical EARS-13 defaults (#1076 window recipe above), and
unset `LOADTEST_SUPPRESS_SYNTHETIC` the same way. No data rollback needed.

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

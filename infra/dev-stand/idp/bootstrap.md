# Zitadel — OIDC application bootstrap (reproducible, per recipe)

The `idp` service (Zitadel v4, single binary, DB-backed) comes up self-contained
from `compose.core.yml` and serves OIDC discovery at the root once healthy. This
file turns the _application-level_ setup — the OIDC client the api BFF logs in
through, plus the org-owner credential the provisioner needs — into a scripted,
re-runnable procedure. No console click-paths.

All commands assume the **TrueNAS Hybrid** recipe (`DEV_SSH_HOST=truenas`,
`sudo docker`, remote dir `~/ds-platform-dev-stand`). On a host-only recipe drop
the `ssh truenas` prefix and the `sudo`. Endpoints come from your `.env.local` —
substitute your own `HOST`/ports; the values shown are the reference recipe's.

> **HOST choice.** The issuer must be the address the api on your dev machine
> resolves _and_ the address Zitadel advertises in discovery — they must be
> byte-identical or every OIDC client rejects the issuer. The reference recipe
> uses `truenas.local` (mDNS resolves from Windows to `192.168.1.115`); fall back
> to the static IP only if mDNS fails. Use the SAME value for
> `IDP_EXTERNAL_DOMAIN` and `IDP_ISSUER` (bare origin, **no path**).
>
> **Redirect URI is NOT the HOST.** `IDP_REDIRECT_URI` (and the URIs
> `provision.sh` registers) point at the **api/portal callback**, and those
> processes run on your **dev machine**, not on the Zitadel host. So the redirect
> URI is `http://localhost:3000/auth/callback` (api BFF) / `:3100/auth/callback`
> (portal) regardless of where Zitadel runs — even on the TrueNAS recipe, where
> `IDP_ISSUER` is `truenas.local` but the api still binds locally. The value in
> `IDP_REDIRECT_URI` must byte-match a redirect URI registered on the OIDC app
> (`provision.sh` step 3); a `truenas.local` redirect URI is **not** registered
> and Zitadel's `/oauth/v2/authorize` returns `400 invalid_request` ("redirect_uri
> is missing in the client configuration"), failing every login (#159).

---

## 0. Snapshot first (destructive steps follow)

A re-init drops the `zitadel` database. **Snapshot before touching it**
(AGENTS.md §9.3):

```bash
pnpm dev:snapshot pre-zitadel-reinit
# TrueNAS recipe, by hand if the launcher isn't usable from your env:
ssh truenas 'sudo zfs snapshot "Daily SSD/dev-postgres@pre-zitadel-reinit-$(date -u +%Y%m%dT%H%M%SZ)"'
```

Only the `zitadel` DB and the `idp` container are ever in scope. **Never** touch
`ds_dev` or any other service.

---

## 1. When do you need a re-init?

You need a re-init **only** to (re)create the bootstrap machine user, or to change
`IDP_EXTERNAL_DOMAIN`. If `curl http://<HOST>:9080/.well-known/openid-configuration`
already advertises the right `"issuer"` and a `ds-bootstrap` org-owner user
exists, skip to step 3 (provisioning).

Zitadel stores `ExternalDomain` in the DB at first init; the container env var
only seeds it on a _fresh_ init. Changing the env var on an already-initialised
instance does nothing — you must re-init.

---

## 2. Re-init with a declarative bootstrap machine user

`compose.core.yml` carries an opt-in FIRSTINSTANCE block, gated on `IDP_BOOTSTRAP`.
When set, the init step creates an IAM-owner machine user `ds-bootstrap`, a console
admin `zitadel-admin` with a known password, writes the machine user's PAT to a
readable file, and enables the **Login V2** feature.

> **Login V2 is required — do not disable it.** The api BFF uses a headless
> Variant-B exchange (apps/api auth design §3, EARS-8): it links a server-checked
> session to a pending OIDC auth request via `POST /v2/oidc/auth_requests/{id}`.
> That session-link API only resolves an auth request **created under Login V2**;
> with the feature off the authorize hop files a v1 auth request the v2 API can't
> see and the link 404s (`Auth Request does not exist`, proven live #146). The v2
> login _UI_ ships as a separate Next.js `login` container — but the BFF never
> renders it (no `baseUri` is configured), so the single-binary stand needs no
> extra service: the `auth_requests` + token endpoints live in the core binary.
> An earlier revision of this bootstrap forced Login V2 off; that was wrong and is
> reverted.

In your `.env.local` (synced to the remote `.env` on `dev:up`):

```ini
IDP_EXTERNAL_DOMAIN=truenas.local       # = your HOST
IDP_ISSUER=http://truenas.local:9080    # bare origin, no path
IDP_PORT=9080
IDP_BOOTSTRAP=1                          # ONLY during the re-init
IDP_BOOTSTRAP_ADMIN_PASSWORD=<pick one>  # dev-only; needs upper+lower+digit+symbol
```

Drop the `zitadel` DB and recreate the `idp` container so `start-from-init`
re-inits onto a fresh DB:

```bash
ssh truenas 'cd ~/ds-platform-dev-stand && \
  sudo docker compose -f compose.core.yml stop idp && \
  sudo docker compose -f compose.core.yml rm -f idp && \
  sudo docker exec ds-platform-dev-postgres-1 psql -U ds -d ds_dev -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"'"'zitadel'"'"' AND pid <> pg_backend_pid();" && \
  sudo docker exec ds-platform-dev-postgres-1 psql -U ds -d ds_dev -c "DROP DATABASE IF EXISTS zitadel;" && \
  sudo docker compose -f compose.core.yml up -d idp'
```

Wait for health, then verify the issuer:

```bash
curl -s http://truenas.local:9080/.well-known/openid-configuration | jq -r .issuer
# -> http://truenas.local:9080
```

### Obtaining the bootstrap PAT (fully scriptable — no console)

`ZITADEL_FIRSTINSTANCE_PATPATH` writes the machine user's PAT to `/pat/pat.txt`
on init. The earlier "the file is never written" claim was a **mount-ownership**
bug, not an init bug: the distroless image runs as the non-root `zitadel` user
(uid/gid 1000), and a default tmpfs / named volume is root-owned, so the process
couldn't create the file. `compose.core.yml` now mounts the PAT tmpfs owned by
uid/gid 1000 (`tmpfs: /pat:uid=1000,gid=1000,mode=0700`), so the file lands
readable. Copy it straight out of the container — no console, no devtools:

```bash
ssh truenas 'PID=$(sudo docker inspect ds-platform-dev-idp-1 --format "{{.State.Pid}}"); \
  sudo cat /proc/$PID/root/pat/pat.txt' > ~/.ds-platform/idp-bootstrap-pat.txt
# (distroless has no shell, so read the file through the host /proc view of the
# container rootfs rather than `docker exec cat`.)
```

The file is gitignored by living under `~/.ds-platform/` — **never** commit it.
Then flip `IDP_BOOTSTRAP=` back off (so normal boots don't re-trigger init).

> The deterministic `zitadel-admin` console user is still created (handy for
> interactive console work), but the PAT no longer needs it.

---

## 3. Provision the OIDC application (idempotent)

`idp/provision.sh` creates (or converges) the `ds-platform-dev` project, the
web/OIDC application (`authorization_code` + `refresh_token`, BASIC auth, dev-mode
http redirect URIs), the project-role assertion so
`urn:zitadel:iam:org:project:roles` is emitted in the token, and seeds the
`doctor_guest` role. It also **ensures the Login V2 instance feature** (a no-op if
the FIRSTINSTANCE default already set it — converges instances created before that
default), **grants `IAM_LOGIN_CLIENT`** to the `ds-bootstrap` machine user —
without it the EARS-8 session-link call returns `403 No matching permissions found`
(`IAM_OWNER` alone is not sufficient) — **configures + activates an SMTP
provider aimed at Mailpit** (`mailpit:1025`) so verification/reset codes (EARS-3)
are actually delivered (Zitadel ships with no SMTP provider, so `email/resend`
200s but mails nothing until this is set; the live email-verify test #148 depends
on it) — and **configures + activates a generic HTTP SMS provider aimed at the
`sms-sink` service** (`http://sms-sink:8090/`) so SMS-OTP login (EARS-7) and phone
verification (EARS-13) codes are delivered to the dev SMS catch-all (Zitadel ships
with no SMS provider either, so the `otpSms` challenge / `phone/resend` 200 but
deliver nothing until this is set; the live SMS-OTP test #170 depends on it). It
finally **localizes the notification language to Russian** (#177): it sets the
instance default language to `ru` **and** locks the allowed-languages restriction
to `[ru]`, so every Zitadel-rendered email/SMS (registration, email-verify,
password-reset, email/SMS OTP) renders from Zitadel's built-in Russian message
texts. Both levers are needed — the instance default alone is only a last-resort
fallback that loses to any request `Accept-Language`, so on its own the live
notifications resolved to random languages; the `[ru]` restriction is what makes
them deterministically Russian (the portal forms were already Russian via #181,
but those IdP-rendered bodies are out of next-intl's reach). Re-running converges
— it never duplicates.

```bash
# Runs on a box with bash + curl + jq (the TrueNAS box has all three):
ssh truenas 'cd ~/ds-platform-dev-stand/idp && \
  IDP_BASE_URL=http://truenas.local:9080 ./provision.sh --pat-file /tmp/idp-pat.txt'
```

It prints `IDP_PROJECT_ID`, `IDP_CLIENT_ID`, and — **only on first creation** —
`IDP_CLIENT_SECRET`, each already prefixed with its `.env.local` key so the lines
append straight in. Capture them. (Re-runs do not re-emit the secret; rotate it
with the `_generate_client_secret` call the script prints if you lose it.) On every
run it also echoes (to stderr) the **redirect URIs it registered** and the
`IDP_REDIRECT_URI=` line to copy (the api BFF `:3000` callback), plus a reminder
that a full api boot additionally needs `AUDIT_IDENTIFIER_PEPPER` — so both #159
values are discoverable on each (re)provision.

Override defaults via env / flags: `IDP_REDIRECT_URIS`, `IDP_POST_LOGOUT_URIS`,
`IDP_SEED_ROLE`, `EMAIL_DELIVERY_MODE` (default `mailpit`; see §3.bis),
`SMS_DELIVERY_MODE` (default `sink`; see §3.bis), `IDP_SMTP_HOST` (default
`mailpit:1025`), `IDP_SMTP_SENDER_ADDRESS`, `IDP_SMTP_SENDER_NAME`,
`IDP_SMS_HTTP_ENDPOINT` (default `http://sms-sink:8090/` in `sink` mode,
`http://sms-aero-adapter:8091/` in `real` mode), `IDP_NOTIFICATION_LANGUAGE`
(default `ru`; the notification + login-UI locale), `IDP_RESTRICT_LANGUAGES`
(default `1`; set `0` to leave the instance multi-locale and rely on the default
language + per-user `preferredLanguage` instead of the `[ru]` lock),
`--project-name`, `--app-name`.
Defaults target the api BFF callback (`:3000/auth/callback`) and the portal
(`:3100/auth/callback`).

> **SMS on the dev-stand = a local catcher, never a real gateway.** The HTTP SMS
> provider points at the `sms-sink` service (compose.core.yml) — the SMS analogue
> of Mailpit. Zitadel POSTs every outbound SMS there as JSON; the sink stores it
> and exposes a tiny REST API (`GET /api/messages?to=<phone>&after=<iso>&event=
<eventType>`, `DELETE /api/messages`) so the live SMS-OTP e2e reads the
> delivered code back by recipient phone — exactly as the email e2e reads codes
> from Mailpit. **SMS-Aero** (smsaero.ru Gate API v2) is the **production** sender
> recorded in the specs (engineering-readiness §5.bis, identity-auth-rbac-design
> §5, ADR-0001 design); the dev-stand never reaches it, and real delivery to a
> real phone is out of scope. The provider URL uses the in-network service name
> (`sms-sink:8090`); the e2e reaches the sink on the published host port
> (`SMS_SINK_URL`, default `http://truenas.local:8090`). No OTP code is ever
> surfaced through an api/BFF response (that would make the EARS-8/16 ack a code
> oracle) — the sink side-channel is the only readback, mirroring Mailpit.

### 3.bis. Switching to REAL delivery (email + paid SMS) — #176

The dev sinks above are the **default**. Since #185 there are TWO ways to switch
to the **real** route, and you should prefer the first:

1. **Runtime, in the Unleash UI (preferred, #185).** `provision.sh` now ensures
   **BOTH** providers per channel EXIST in Zitadel (Mailpit + real SMTP; sms-sink +
   SMS-Aero), each with a stable `description`. The api's delivery reconcile reads
   the Unleash flags `email-delivery-real` / `sms-delivery-real` and `_activate`s
   the matching provider on a flag change — **no `.env.local` edit, no
   `provision.sh` re-run, no restart**. Toggle the flag in the admin UI
   (`http://<HOST>:4242`) and the next Zitadel-sent OTP goes real vs intercepted.
   (Real SMTP must have its `IDP_SMTP_REAL_*` creds set at provision time, else
   that provider is skipped and the reconcile leaves email on Mailpit with a note.)

2. **Boot-time, via env (the original #176 mechanism).** `EMAIL_DELIVERY_MODE` /
   `SMS_DELIVERY_MODE` now select which of the two pre-configured providers
   `provision.sh` **activates at boot** (the bootstrap default the api reconcile
   then overrides when Unleash is reachable). Use this only to change the boot mode
   or on a stand with no running api. Steps 6/7 are idempotent — safe to re-run.

| Boot flag             | Default   | `real` value                                              |
| --------------------- | --------- | --------------------------------------------------------- |
| `EMAIL_DELIVERY_MODE` | `mailpit` | the real transactional sender (`IDP_SMTP_REAL_*`, TLS on) |
| `SMS_DELIVERY_MODE`   | `sink`    | `sms-aero-adapter` → SMS-Aero (smsaero.ru Gate API v2)    |

> **Real SMS costs money — that is why it is OFF by default.** `SMS_DELIVERY_MODE`
> stays `sink` (the free local catch-all) for all day-to-day work; flip it to
> `real` only for **one supervised paid SMS** to confirm the live route, then flip
> it back. When `real`, Zitadel POSTs each outbound SMS to the in-network
> `sms-aero-adapter:8091` service (compose.core.yml), which forwards it to SMS-Aero
> using **HTTP Basic** auth + a form-urlencoded body (it faithfully mirrors the
> production PHP client `bbm/dev-stand/server/lib/smsaero-client.php`). Zitadel
> never reaches SMS-Aero directly — the adapter holds the creds and does the
> egress, and **fails closed** (logs a structured `smsaero.*` event, returns a
> non-2xx, never crashes, never logs the OTP or creds) if the phone can't be
> parsed, the creds are missing, or SMS-Aero errors.
>
> **Where the creds come from — never the repo.** The SMS-Aero keys
> (`SMSAERO_EMAIL` / `SMSAERO_API_KEY` / `SMSAERO_SIGN`) live in **production**
> only in Beget `~/.env`. For the dev-stand paid test, copy them into your
> gitignored `.env.local` (synced to the remote compose `.env`), run the test,
> then remove them / set `SMS_DELIVERY_MODE=sink` again. They must **never** be
> committed — `.env.example` carries commented `CHANGE_ME` placeholders only.

To flip a flag (TrueNAS recipe — set the flag in `.env.local`, sync, re-run):

```bash
# in ~/.ds-platform/.env.local: EMAIL_DELIVERY_MODE=real (and IDP_SMTP_REAL_*),
#   and/or SMS_DELIVERY_MODE=real (and SMSAERO_* for the supervised paid test)
pnpm dev:up   # syncs .env.local -> remote .env so the adapter sees the creds
ssh truenas 'cd ~/ds-platform-dev-stand/idp && \
  IDP_BASE_URL=http://truenas.local:9080 \
  EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
  ./provision.sh --pat-file /tmp/idp-pat.txt'
# provision.sh ensures BOTH providers per channel exist and ACTIVATES the `real`
# one as the boot default. Re-run with the defaults (or omit the vars) to activate
# the sinks again — both providers always exist, only the active one changes. At
# runtime, prefer toggling the Unleash flags (option 1 above) instead of re-running.
```

If `EMAIL_DELIVERY_MODE=real` but the real SMTP provider was **skipped** (its
`IDP_SMTP_REAL_*` creds were absent at provision time), `provision.sh` activates
Mailpit instead with a loud WARN — you cannot test real email without creds, and
it never silently leaves email unconfigured. Set `IDP_SMTP_REAL_*` to provision and
activate the real sender. (The SMS providers need no creds in Zitadel — the
`sms-aero-adapter` holds the SMS-Aero keys and does the egress.)

> **DoD note (operator-verified live).** The two live checks — a real verification
> email actually arriving, and one supervised paid SMS arriving on a real handset —
> require the running stand (TrueNAS, not 24/7) and real creds, so they are
> confirmed by the operator after merge; the code + provisioning here is what makes
> them reachable.

---

## 4. Wire `.env.local`

```ini
IDP_ISSUER=http://truenas.local:9080          # bare origin
IDP_EXTERNAL_DOMAIN=truenas.local
IDP_PORT=9080
IDP_CLIENT_ID=<from provision.sh>             # the numeric Zitadel client id
IDP_CLIENT_SECRET=<from provision.sh>
IDP_PROJECT_ID=<from provision.sh>            # the IDP_PROJECT_ID= line the script
                                              # emits; the project owning the
                                              # doctor_guest role.
                                              # Required to grant the project role per
                                              # user on register/webhook/reconcile (#157)
                                              # — the OIDC token's project-roles claim is
                                              # the authz source the guard reads; absent
                                              # it grantProjectRole fails closed and a
                                              # registered user 403s on protected routes.
IDP_REDIRECT_URI=http://localhost:3000/auth/callback  # api BFF callback — runs
                                              # on the dev machine, so it is
                                              # localhost even on the truenas.local
                                              # recipe. MUST byte-match a redirect
                                              # URI provision.sh registers (it
                                              # echoes them on completion); a
                                              # truenas.local value is not
                                              # registered -> authorize 400 (#159).
IDP_SERVICE_TOKEN=<the ds-bootstrap PAT>      # the api binds the real adapter on
                                              # IDP_ISSUER + IDP_SERVICE_TOKEN
```

> **`AUDIT_IDENTIFIER_PEPPER` (separate from the OIDC wiring).** A full `@ds/api`
> boot also needs `AUDIT_IDENTIFIER_PEPPER` in `.env.local` — the #141 audit-ledger
> HMAC gate is fail-closed, so an unset pepper makes `DrizzleAuthAuditLog` DI throw
> and `node dist/main.js` never finishes boot (surfaced live by #158). It is **not**
> a Zitadel artifact (`provision.sh` does not emit it). Generate one high-entropy
> value once and keep it stable across dev restarts — see the `.env.example`
> comment. Mint with `openssl rand -hex 32`.

> The api's `IdpModule` selects the real `ZitadelIdpClient` when **both**
> `IDP_ISSUER` and `IDP_SERVICE_TOKEN` are set; otherwise it falls back to the
> in-memory `FakeIdpClient`. The OIDC `client_id` / `client_secret` /
> `redirect_uri` are the confidential-client creds the BFF presents on the
> authorize→token-exchange leg (EARS-8) and the refresh-rotation leg (EARS-9), not
> for adapter selection.

To prove the live exchange end-to-end, run the integration spec with the OIDC env
exported (it `describe.skipIf`s without `IDP_ISSUER`/`IDP_CLIENT_ID`/
`IDP_SERVICE_TOKEN`/`IDP_REDIRECT_URI`):

```bash
# from apps/api, with the five IDP_* keys + DATABASE_URL exported from .env.local
npx vitest run test/auth/zitadel-token-exchange.e2e-spec.ts
# -> EARS-8 (session→token) + EARS-9 (refresh rotation) GREEN
```

---

## 5. Live wire-shape deltas (v4.15) — all resolved in the adapter

Running the real adapter against the live instance surfaced wire-shape deltas vs
the merged code. The EARS-8/9 token-exchange spec
(`apps/api/test/auth/zitadel-token-exchange.e2e-spec.ts`) now passes GREEN against
the dev-stand; the deltas it forced are fixed in `src/auth/idp/zitadel.idp.ts`:

- `POST /v2/users/human` **requires** a `profile` object (`givenName` /
  `familyName`) — fixed in `createUser` (#145, a placeholder profile the domain
  never reads).
- `POST /v2/sessions` does **not** echo `factors` in its response — the checked
  user's id is read via a follow-up `GET /v2/sessions/{id}` (#145).
- The authorize 302 redirects to `…?authRequest=V2_<id>` (lowercase `authRequest`,
  `V2_` prefix) under Login V2 — the adapter reads both `authRequestID` and
  `authRequest` (#122/#145).
- The **refresh** grant rejects the reserved `urn:zitadel:iam:org:project:roles`
  scope with `invalid_scope`; per RFC 6749 §6 a refresh may only narrow scope, so
  `refreshTokens` now sends **no** `scope` param (the roles claim still rides the
  rotated id_token via the app's role-assertion config). This was the EARS-9 fix.
- Duplicate-email create returns **409** (the adapter's enumeration hinge is
  correct); the happy path returns `{ userId, details }` (parsed correctly).
- The default password policy requires an upper-case character; live test
  fixtures use a mixed-case password accordingly.

Two instance-level prerequisites for the exchange (both applied by `provision.sh`,
documented in §2/§3): **Login V2 enabled**, and **`IAM_LOGIN_CLIENT`** on the
machine user the PAT belongs to.

The OTP-login legs (`requestEmailOtp` / `loginWith*Otp`) remain fail-closed seams
(tracked separately); they are not exercised by the token-exchange spec.

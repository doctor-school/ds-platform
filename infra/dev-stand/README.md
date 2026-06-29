# Local dev-stand

Local development environment for DS Platform — Postgres, Redis, MinIO, `idp`
(Zitadel core) with its `idp-login` (Login V2 UI) + `idp-proxy` (Caddy single-origin
front), Centrifugo, Cerbos, Mailpit and friends, run as a Docker Compose stack.

The platform contract (compose files, `.env.example`, DX wrappers) is portable and
lives in git. Each developer picks a **recipe** for _where_ Docker actually runs.
The reference recipe — "TrueNAS Hybrid" — runs app processes on the host and the
stateful containers on a LAN TrueNAS box reached over SSH.

On this recipe the TrueNAS box is **shared** with unrelated projects (home-budgeting,
media-index, RTMP, TrueNAS Apps). The dev-stand must stay isolated from them — see
[Container isolation](#container-isolation).

Docker on the box runs via `sudo docker` over the `truenas` SSH alias — the
established convention for this server (see `home-budgeting-system/ARCHITECTURE.md`
§11). The `pnpm dev:*` DX scripts (`tools/dev/run.mjs`, DSP-156) call
`sudo docker compose` over `ssh.exe`; the `DOCKER_HOST=ssh://` transport is **not**
used (it needs direct socket access — deferred, setup-design §11 OQ-1).

Full design: [`local-dev-environment-setup-design`][spec]. This directory holds
the Layer-A portable contract: the bootstrap checklist (DSP-152), the
portable-contract files (DSP-153), the `compose.core.yml` service definitions
(DSP-154) and the ZFS recipe (DSP-155). The `pnpm dev:*` DX scripts that drive
the stack live in `tools/dev/` (DSP-156) — see [DX commands](#dx-commands).

[spec]: ../../apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md

---

## Setup

The dev-stand is two layers (setup-design §2.1): the **portable contract** in git
(`compose.core.yml`, `.env.example`, this README) and a **personal recipe** kept
outside git (`.env.local`, `compose.override.yml`). Setup order:

1. **Prerequisites** — for the TrueNAS Hybrid recipe, complete the
   [Bootstrap checklist](#bootstrap-checklist) below first. Host-only recipes can
   skip it.
2. **Personal env** — copy the env template and fill in real values for your
   machine (`HOST`, `DOCKER_HOST`, passwords, data paths):

   ```powershell
   cp .env.example ~/.ds-platform/.env.local
   ```

3. **Personal override (optional)** — only if your recipe needs a non-default
   storage topology (bind mounts, cloud disks). Named volumes work without it:

   ```powershell
   cp compose.override.example.yml ~/.ds-platform/compose.override.yml
   ```

4. **Start the stack** — `pnpm dev:up` (see [DX commands](#dx-commands)).

`.env.local` and `compose.override.yml` are gitignored (see `.gitignore` in this
directory) — they hold per-machine secrets and must never be committed.

> **Save bootstrap secrets** (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`,
> `IDP_SECRET_KEY`, …) in a password manager. They are not covered by ZFS
> snapshots or host backups — on a wipe they are lost and must be rotated
> (setup-design §10).

---

## Data layer (Postgres image)

The `postgres` service runs a **repo-built** image (`postgres/Dockerfile`), not a
plain upstream tag: it extends `pgvector/pgvector:pg17` with **`pg_partman`** so
the native monthly RANGE partitions on `audit_ledger` (#367) are auto-created
(ADR-0003 §3 / §6; #136). `vector` and `pg_partman` coexist — `init.sql` enables
both on a fresh cluster (`vector` in `public`, `pg_partman` in a dedicated
`partman` schema). Auto-creation runs **inside Postgres via the pg_partman
background worker**: `postgres/postgresql.conf.dev` sets
`shared_preload_libraries = 'pg_partman_bgw'` plus the `pg_partman_bgw.*` GUCs
(dbname `ds_dev`, role `ds`, hourly interval), so no external cron is needed. The
GUCs are per-env — prod sets the equivalent values in its own conf; the **image**
is the shared binary SSOT. (The 5y retention `DROP PARTITION` is the #383
follow-up — the drop-mask is disabled on v1, so no retention is configured.)

The **same Dockerfile is the prod data-layer image source** — the deploy pipeline
builds + pushes it to the registry so pgvector + pg_partman are present in every
environment (engineering-readiness data-layer plan). **CI builds the same image**
too: the `api-e2e` job builds `postgres/Dockerfile` and runs it (the bare
pgvector tag has no pg_partman), so migration `0004` can install the extension.

`docker compose up` builds the image on first use when the tag is absent. After a
Dockerfile change, rebuild explicitly:

```powershell
ssh truenas "cd <stand-dir> && sudo docker compose -f compose.core.yml build postgres"
```

> **Existing volume?** `postgres/init.sql` enables `pg_partman` only on a **fresh**
> cluster. On a dev-stand whose Postgres volume already exists, enable it once after
> rolling out the new image (the package is now baked in, so this just creates the
> extension):
>
> ```powershell
> ssh truenas "sudo docker exec ds-platform-dev-postgres-1 psql -U ds -d ds_dev -c 'CREATE SCHEMA IF NOT EXISTS partman AUTHORIZATION ds; CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;'"
> ```

---

## Identity provider Console (Zitadel, operator-only)

The Zitadel admin **Console** is browsable at
`http://<HOST>:9080/ui/console` (e.g. `http://truenas.local:9080/ui/console`),
logging in as `zitadel-admin@zitadel.<IDP_EXTERNAL_DOMAIN>` (e.g.
`zitadel-admin@zitadel.truenas.local`) with `IDP_BOOTSTRAP_ADMIN_PASSWORD` from
your `.env.local`. This is a **dev-operator convenience only** — the product auth
path (the api BFF) stays headless and never routes through this UI.

> **Browse via the `truenas.local` mDNS hostname, not the static-IP fallback** —
> Caddy host-matches `${IDP_EXTERNAL_DOMAIN}` and Zitadel resolves the instance by
> the same domain, so the Console only routes via the hostname (the same one the
> issuer requires). If mDNS is down (see [`dev-stand.md`](../../.claude/rules/dev-stand.md)
> failure table), fix mDNS / add a hosts entry rather than browsing by IP. Full detail,
> including the single-origin architecture and the PAT-mount step, is in
> [`idp/bootstrap.md` §6](idp/bootstrap.md).

Zitadel v4 splits the login UI out of the core binary, so three containers serve
the one `${IDP_PORT:-9080}` origin:

- **`idp`** (Zitadel core) — OIDC/JWT, Console, management/admin APIs. Now
  **in-network only** (`idp:8080`); it no longer publishes a host port.
- **`idp-login`** (`ghcr.io/zitadel/zitadel-login`, pinned to the core version) —
  the Login V2 Next.js UI, served under `/ui/v2/login`. Authenticates to core with
  the `ds-bootstrap` PAT (which already carries `IAM_LOGIN_CLIENT`), mounted
  read-only from `IDP_LOGIN_PAT_FILE` — a path **outside** the synced stand dir so
  `dev:up` never wipes it.
- **`idp-proxy`** (Caddy, pinned) — publishes `${IDP_PORT:-9080}` and
  single-origin-routes `/ui/v2/login/*` → `idp-login:3000`, everything else →
  `idp:8080` over h2c. Because it fronts the same origin, the OIDC **issuer is
  unchanged** (`http://<HOST>:9080`) and the headless BFF path is untouched.

> The Login V2 `baseUri` (what makes the Console's interactive login render the
> v2 UI) is set idempotently by `idp/provision.sh` step 4 — no console click-path.

---

## Feature flags (Unleash)

[Unleash](https://www.getunleash.io/) self-hosted (#184) is the runtime
feature-flag service — operators toggle flags at runtime, with a UI, without
editing `.env.local` and restarting services. It is Postgres-backed (no named
volume; its tables live in a dedicated `unleash` schema inside the shared `ds_dev`
database, like `idp`) and published on `${UNLEASH_PORT:-4242}`. The connection
pins its search_path to that schema (`DATABASE_URL …?options=-c search_path=unleash`)
so Unleash's migrations don't collide with the api's `public.users` table —
`DATABASE_SCHEMA` alone is not enough on Unleash 8.x.

> **Existing volume?** `postgres/init.sql` creates the `unleash` schema only on a
> **fresh** cluster. On a dev-stand whose Postgres volume already exists, create it
> once before first boot:
>
> ```powershell
> ssh truenas "sudo docker exec ds-platform-dev-postgres-1 psql -U ds -d ds_dev -c 'CREATE SCHEMA IF NOT EXISTS unleash AUTHORIZATION ds;'"
> ```

- **Admin UI** — `http://<HOST>:4242` (e.g. `http://truenas.local:4242`).
  Operators create / toggle flags here.
- **Dev admin** — the built-in default account `admin` / `unleash4all`. This is
  **dev-only on the trusted LAN**, mirroring the Zitadel dev-admin precedent. For
  prod it is replaced with real auth (SSO / a rotated admin) behind Caddy — never
  expose the default credential off the dev-stand.
- **API tokens** — two tokens are seeded at boot from env (`INIT_*_API_TOKENS`):
  a **client/server** token the api SDK consumes and a **frontend** token the
  portal consumes (`UNLEASH_INIT_CLIENT_API_TOKEN` /
  `UNLEASH_INIT_FRONTEND_API_TOKEN`). Real values live ONLY in `.env.local` (dev) /
  Beget `~/.env` (prod) → Vault later — never committed. The api SDK reads its
  token from `UNLEASH_API_TOKEN` (mirror the seeded client token) and its base URL
  from `UNLEASH_URL` (note the `/api` suffix).

### Runtime flags the api reads (#185)

The api reads three **dev-stand-only** flags from Unleash. Create them once in the
`development` environment (default OFF) and toggle them in the admin UI — no
`.env.local` edit + restart:

| Flag                  | OFF (default)                   | ON                                         | How the api applies it                                                     |
| --------------------- | ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `bot-protection`      | captcha gate open (dev)         | `@BotProtected` endpoints enforce captcha  | **per request** — the guard reads the flag live on every call              |
| `email-delivery-real` | email OTP → Mailpit (intercept) | email OTP → real SMTP sender               | **reconcile** — flag change → Zitadel `_activate` of the matching provider |
| `sms-delivery-real`   | SMS OTP → sms-sink (intercept)  | SMS OTP → SMS-Aero (real, **costs money**) | **reconcile** — flag change → Zitadel `_activate` of the matching provider |

**Precedence + fallback.** When Unleash is reachable its flag value wins. When it
is unreachable (or `UNLEASH_URL`/`UNLEASH_API_TOKEN` are unset, the shared-CI
default) every flag falls back to its **env bootstrap default**
(`BOT_PROTECTION_ENABLED` for `bot-protection`; `EMAIL_DELIVERY_MODE` /
`SMS_DELIVERY_MODE` `=== real` for the two delivery flags — the same knobs
`provision.sh` reads, so boot intent and the api fallback share one source). The
`bot-protection` fallback is **fail-closed** — an Unleash outage never silently
opens the gate. The env defaults also seed the boot-time state before the first
SDK poll.

**The delivery reconcile path.** The api does **not** send OTP email/SMS —
**Zitadel** does, via its currently **active** provider. So a delivery flag cannot
branch in our code; it must repoint Zitadel. `idp/provision.sh` pre-configures
**both** providers per channel (Mailpit + real SMTP; sms-sink + SMS-Aero), each
with a stable `description`. On a flag change the api's reconcile finds the
provider whose description matches the desired mode and calls the admin
`…/_activate` (it holds **no** SMTP/SMS secrets — it only flips which
pre-configured provider is active). It is idempotent (already-active ⇒ no-op) and
safe: if the desired provider is not provisioned (e.g. real SMTP with no
`IDP_SMTP_REAL_*` creds, so `provision.sh` skipped it) it leaves the active
provider unchanged and logs a clear note — it never activates the wrong provider.

**Dev-stand only.** In production the providers are always real and there is no
delivery toggle; these flags are a dev-stand affordance for testing the full
registration cycle against live vs intercepted email/SMS.

---

## DX commands

The stack is driven by `pnpm dev:*` scripts — a cross-platform Node launcher
(`tools/dev/run.mjs`) that reads your `.env.local`, picks the transport, and runs
`docker compose` against the dev-stand (setup-design §9).

| Command                      | Does                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `pnpm dev:up`                | Start the stack (detached).                                         |
| `pnpm dev:down`              | Stop the stack; named volumes preserved.                            |
| `pnpm dev:status`            | List dev-stand containers (`docker compose ps`).                    |
| `pnpm dev:logs [service]`    | Follow logs — all services, or one (`pnpm dev:logs postgres`).      |
| `pnpm dev:restart [service]` | Restart all services, or one.                                       |
| `pnpm dev:psql`              | Open a `psql` shell on `ds_dev` (`docker compose exec postgres …`). |
| `pnpm dev:snapshot <desc>`   | Pre-migration snapshot — recipe-specific.                           |
| `pnpm dev:rollback <name>`   | Roll the database back to a snapshot — recipe-specific.             |
| `pnpm dev:reset-db`          | Drop + recreate the database volume, then start.                    |
| `pnpm dev:config`            | Validate compose + `${SECRET}` interpolation, without an `up`.      |

**Transport.** The launcher reads `DEV_SSH_HOST` / `DEV_DOCKER_SUDO` /
`DEV_REMOTE_DIR` from `.env.local` (see `.env.example`). With `DEV_SSH_HOST` set
it runs `sudo docker compose` on the box over `ssh.exe`; with it empty it uses
the local Docker daemon. `dev:up`, `dev:reset-db` and `dev:config` first sync
`infra/dev-stand/` to `DEV_REMOTE_DIR` on the box — staged into a temp dir and
swapped in only once fully transferred, so a failed transfer never disturbs a
running stack. The other commands run against that already-synced dir, so
`dev:up` is what keeps the box in step with the contract in git.

**Secrets.** `.env.local` is the single secret source for compose
interpolation (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `IDP_SECRET_KEY`, …).
The SSH recipe ships it verbatim to `DEV_REMOTE_DIR/.env` on every sync (compose
auto-loads it from the project dir); the host-only recipe passes the parsed
values through the `docker compose` subprocess environment. Either way the stack
comes up with real secrets from one local file — no manual `docker compose` on
the box, no secret committed to git.

**Before a migration.** Always run `pnpm dev:snapshot pre-mig-<desc>` before
`pnpm drizzle:migrate`. The portable agent rules for the stand — snapshot-before-migrate,
never-edit-volumes, LAN-is-trusted — live in [`AGENTS.md` §9](../../AGENTS.md#9-local-dev-stand).

**Recipe-specific commands.** `dev:snapshot` / `dev:rollback` carry no portable
implementation — their logic lives per recipe in
`tools/dev/recipes/<recipe>/*.sh` (setup-design §9.1). The TrueNAS Hybrid recipe
ships `tools/dev/recipes/truenas-hybrid/{snapshot,rollback}.sh` (ZFS). On a
host-only recipe both commands warn and no-op.

**Not yet wired.** `dev:reset-db` recreates the volume and starts the stack, but
the schema-migrate + seed steps are added once `apps/api` exists (setup-design
§11 OQ-4).

---

## Bootstrap checklist

One-time prerequisites before the dev-stand can be brought up. Step 1–2 are
recipe-specific (TrueNAS Hybrid); steps 3–5 are host-side and apply to anyone
talking to a remote Docker host over SSH.

Re-run the **verification** command after each step. The stand is bootstrap-ready
when all five verifications pass.

### 1. SSH access to TrueNAS Docker

The dev-stand reaches Docker over the `truenas` SSH alias as user `claude`, which
is already provisioned on the box (key in `~/.ssh/authorized_keys`, passwordless
sudo). Docker commands run with `sudo docker` — `claude` is intentionally **not** in
the `docker` group, matching the existing server convention. No new user, no group
change is needed.

The host `~/.ssh/config` alias:

```
Host truenas
    HostName 192.168.1.115
    User claude
    IdentityFile ~/.ssh/truenas
```

**Verification** (from the host):

```powershell
ssh truenas "sudo docker version"
```

Must print both Client **and** Server sections.

### 2. DHCP reservation for TrueNAS

Pin TrueNAS to `192.168.1.115` so `truenas.local` and the static-IP fallback stay
stable across leases (setup-design §5.4).

- On the router: add a DHCP reservation binding the TrueNAS MAC to `192.168.1.115`.

**Verification:**

```powershell
ping truenas.local        # must resolve to 192.168.1.115
arp -a 192.168.1.115      # confirm the MAC matches TrueNAS
```

### 3. Windows network profile = Private

The Windows mDNS resolver answers `*.local` only on a **Private** profile. On a
fresh install or after a profile reset, `truenas.local` silently fails until
switched (setup-design §5.2, caveat 1).

- If the profile is `Public`, switch it:

  ```powershell
  Set-NetConnectionProfile -InterfaceIndex <N> -NetworkCategory Private
  ```

**Verification:**

```powershell
Get-NetConnectionProfile | Select-Object Name, InterfaceIndex, NetworkCategory
```

`NetworkCategory` must be `Private`.

### 4. OpenSSH client present

DX wrappers shell out to the native Windows `ssh.exe`. Windows 11 ships the
OpenSSH client by default.

**Verification:**

```powershell
where.exe ssh
ssh -V
```

If missing: Settings → System → Optional features → add **OpenSSH Client**.

### 5. mDNS resolution + SSH smoke test

End-to-end check that `truenas.local` resolves and Docker is reachable.

**Verification:**

```powershell
ping truenas.local
ssh truenas "sudo docker version"
```

Attach the `docker version` output to the DSP-152 Plane thread once it passes.

> **WSL2 caveat:** mDNS inside WSL2 default NAT mode does not work
> (microsoft/WSL#12354). Run DX scripts from native Windows `ssh.exe`, or fall back
> to the static IP `192.168.1.115` in WSL's `/etc/hosts`.

---

## Container isolation

The TrueNAS box co-hosts unrelated Docker workloads (`home-budgeting-system-*`,
`media-index-system`, `rtmp-server`) and TrueNAS Apps (`ix-jellyfin`, `ix-transmission`,
`ix-pihole`). The DSP dev-stand must not collide with any of them. Enforcement lands
with the compose stack in DSP-154; the rules are fixed here so DSP-154 implements them:

- **Project name** — the compose stack sets a fixed `name: ds-platform-dev`, so every
  container is `ds-platform-dev-<svc>-1` and never clashes with `home-budgeting-system-*`.
- **Network** — a dedicated bridge `ds-platform-dev_default`; no `network_mode: host`,
  no shared external networks.
- **Volumes** — named volumes are project-prefixed; ZFS bind-mounts live under the
  dev-stand-only datasets `Daily/dev-*` (setup-design §5.3).
- **Host ports** — the setup-design port list collides with ports already bound on
  TrueNAS. DSP-154 must remap these:

  | Service (spec port)                                                                                    | Status on TrueNAS                                             | Action for DSP-154                |
  | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
  | Postgres `5432`                                                                                        | **in use** — `home-budgeting-system-db-1` (`5433` also taken) | remap host side, e.g. `5442:5432` |
  | `8000`                                                                                                 | **in use**                                                    | remap, e.g. `8100:8000`           |
  | `8001`                                                                                                 | **in use**                                                    | remap, e.g. `8101:8001`           |
  | `6379`, `9000`, `9001`, `9080`, `9443`, `3100`, `4000`, `1025`, `8025`, `8090`, `4242`, `3592`, `3593` | free                                                          | keep as-is                        |

  Prefer **not publishing** internal-only ports at all and reaching services over the
  Docker network / SSH tunnel; publish only what the host apps genuinely need.

  > **`9080` is now published by `idp-proxy` (Caddy), not `idp` directly** (#174):
  > the host port is unchanged, but `idp` (`:8080`), `idp-login` (`:3000`) and
  > Caddy's admin (`:2019`) are all in-network only. No new host ports are
  > published.

**Verification** — re-check for collisions before `compose up` (free ports print nothing):

```powershell
ssh truenas "sudo ss -tlnH | awk '{print \$4}' | sed 's/.*://' | sort -nu" |
  Select-String -Pattern '^(5432|8000|8001|6379|9000|9001|9080|9443|3100|4000|1025|8025|8090|3592|3593)$'
```

---

## Checklist status

| #   | Check                                 | Status                  |
| --- | ------------------------------------- | ----------------------- |
| 1   | SSH access — `claude` + `sudo docker` | ✅ verified 2026-05-22  |
| 2   | DHCP reservation `192.168.1.115`      | ✅ confirmed 2026-05-22 |
| 3   | Windows network profile = Private     | ✅ verified 2026-05-22  |
| 4   | OpenSSH client present                | ✅ verified 2026-05-22  |
| 5   | mDNS resolution + SSH smoke test      | ✅ verified 2026-05-22  |

# `@ds/api`

The DS Platform **backend API** — the BFF that fronts every product surface.
**NestJS 11 + Fastify**, Zod-validated REST, generated openapi-typescript SDK
(ADR-0002). Deployed as `api.doctor.school` alongside the portal; the 003 auth
vertical (registration + passwordless email/SMS-OTP login) is the live scope.

## Public surface

HTTP routes, grouped by NestJS feature module under `src/` — each module owns its
controllers, providers, and a per-module `README.md` (the `module-readme` guard):

```
src/
├── main.ts            # Fastify bootstrap
├── api-application.ts # shared full-AppModule application configuration
├── app.module.ts      # root module wiring
├── auth/              # sessions, OIDC, OTP login
├── authz/             # Cerbos policy enforcement
├── registration/      # new-account registration
├── bot-protection/    # abuse / rate limiting
├── feature-flags/     # Unleash-backed flags
├── mailer/            # transactional-email channel (distinct from Zitadel emails)
├── delivery-reconcile/# email/SMS delivery reconciliation
├── events/ · room/    # webinar events + rooms
├── storage/           # S3/MinIO objects
├── health/ · readiness/ · observability/
```

The wire contract is the Zod SSOT in `@ds/schemas`; the data layer is `@ds/db`
(Drizzle). Auth-related endpoints are `endpoint-authz`-guarded (BLOCK guard).

## Build / test

```bash
pnpm --filter @ds/api dev              # nest start --watch
pnpm --filter @ds/api build            # nest build → dist/
pnpm --filter @ds/api start            # node dist/main.js
pnpm --filter @ds/api test             # vitest run (api e2e uses real Postgres)
pnpm --filter @ds/api typecheck        # tsc --noEmit
pnpm generate:api-client               # OpenAPI snapshot + typed client
pnpm generate:api-client:check         # fail on stale output, write nothing
pnpm --filter @ds/api drizzle:generate # drizzle-kit generate (schema in @ds/db)
pnpm --filter @ds/api drizzle:migrate  # snapshot + drizzle-kit migrate
```

`@ds/api` tests run only in the `api-e2e` CI job, not the shared unit job — see
the CI test topology. That job stands up **both** dependencies the suites gate
on: the pgvector/pg_partman Postgres image and a real **Zitadel IdP** (the same
recipe and bootstrap env as `admin-e2e` and the dev stand, on the runner's host
network at `http://localhost:9080`, provisioned by
`infra/dev-stand/idp/provision.sh`). Before #1595 the job exported only
`DATABASE_URL`, so every
`describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)` suite —
taxonomy, room, registration, recordings, me, admin — skipped and the check-run
went green having executed none of them.

The environment reaches vitest through `turbo.json` → `test.passThroughEnv`
(turbo's env mode is strict: an undeclared variable is invisible to the task), and
the run is closed by `pnpm ci:assert-e2e-ran` (`tools/ci/assert-no-skipped-e2e.ts`,
harness `tools/lint/guard-tests/assert-no-skipped-e2e.spec.ts`). That guard reads
the vitest JSON report and fails the job when a required `IDP_*`/`DATABASE_URL`
variable is missing, when no api e2e test executed at all, or when an e2e test
skipped for any reason other than a service this tier deliberately does not
provision (object storage, Centrifugo, the mail/SMS sinks) — the exemption is
read from the spec's own `skipIf` conditions, never from a file allowlist, and it
is scoped to the individual TEST: each skipped test is attributed to its own
`it.skipIf` plus the `describe.skipIf` blocks enclosing it. A mixed-gate file —
the common shape here, a file-level `!DATABASE_URL || !IDP_ISSUER` describe with
an inner `it.skipIf(!CENTRIFUGO_URL)` — therefore cannot let the inner
unprovisioned gate excuse the outer, IDP-gated tests. So a future missing
variable can no longer skip its way to a green gate.

API generation builds the production compiler output, creates the same full
Fastify `AppModule` configured by `api-application.ts`, and scans it without
`app.init()` or `listen()`. The generator supplies non-routable generation-only
database/config values, so it neither connects to Postgres nor starts lifecycle
hooks. Both the committed OpenAPI snapshot and `@ds/api-client` are compared in
memory by the blocking `generated-artifacts` CI job.

Running the e2e suites locally against the dev stand needs two env facts beyond
the endpoints in `~/.ds-platform/.env.local`:

- `BOT_PROTECTION_ENABLED=false` in the **vitest process env**. With it on,
  `POST /v1/auth/register` answers 403 and every suite that registers a
  principal (all the admin/auth e2e) fails inside its `adminSession()` helper —
  the 403 surfaces as an unrelated-looking assertion, not as a captcha error.
- A per-branch database rather than the shared `ds_dev`:
  `pnpm dev:db:branch <issue-N>` creates and migrates one, and prints the
  `DATABASE_URL` to export for that session.

Suites that drive the IdP **bind** their `FakeIdpClient` with
`.overrideProvider(IDP_CLIENT).useValue(fake)`; they never read it back off the
container. `IdpModule` selects the real `ZitadelIdpClient` whenever `IDP_ISSUER`
and `IDP_SERVICE_TOKEN` are configured — the normal state of a dev stand, and
now of the `api-e2e` job too — so a suite that reads `IDP_CLIENT` back off the
container gets the real adapter, not its own fake, everywhere the suites
actually run. `test/auth/idp-fake-seam.spec.ts` pins both that rule and the
fake↔real port parity.

## Recordings backfill (014 EARS-29)

`pnpm --filter @ds/api recordings:backfill` attaches and publishes the missing
recordings of **platform-born** эфиры in bulk. It is a driver over the ordinary
014 commands (`AttachRecording` + `PublishRecording`) — no second write path, no
direct row insert — so the slot guard, the duration derivation and the feature-010
audit rows are exactly the ones the «Записи» admin tab produces.

The manifest is a JSON array, one entry per event, each carrying an `edited`
and/or a `raw` source:

```json
[
  {
    "event": "kardiologiya-2026-04-12",
    "edited": {
      "provider": "rutube",
      "embed_ref": "0123…",
      "duration_sec": 5400
    },
    "raw": {
      "provider": "rutube",
      "embed_ref": "fedc…",
      "poster": "posters/kardio.jpg"
    }
  },
  {
    "event": "3f1c…-uuid",
    "edited": { "provider": "rutube", "embed_ref": "89ab…" }
  }
]
```

`event` is the event **id or slug**; `poster` and `duration_sec` are optional.
The whole manifest is validated before the first write, so a typo in row 40
never leaves rows 1–39 committed.

Run it with the target environment injected (there is no dotenv autoload):

```bash
set -a; source ~/.ds-platform/.env.local; set +a
# 1. dry run — prints the verdict of every row, writes nothing
pnpm --filter @ds/api recordings:backfill -- --manifest ./backfill.json --actor <zitadel-sub> --dry-run
# 2. the real run
pnpm --filter @ds/api recordings:backfill -- --manifest ./backfill.json --actor <zitadel-sub>
```

`--actor` is the Zitadel `sub` of the operator running it and is **required**:
every committed row is attributed to them in the audit ledger, through the door
`system:recordings-backfill`. Stdout is one JSON object per manifest row plus a
final summary line.

Reading the per-row `outcome`:

| Outcome              | Meaning                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `attached+published` | The kind slot was free; a draft was attached and published (two audit rows).                 |
| `published`          | The kind already held a non-retired **draft**; only the publish ran.                         |
| `skipped`            | The kind already carries a published recording. Nothing was written — re-runs are safe.      |
| `would-attach`       | Dry-run only: this row would be written. `detail` says whether that is an attach or publish. |
| `refused`            | The row was rejected and the run continued; `code` carries the refusal.                      |

The refusal codes are the ones the commands themselves raise:
`EVENT_NOT_FINISHED` (a platform event that is not `ended`, a passed `published`
one included — moving it is [#1814](https://github.com/doctor-school/ds-platform/issues/1814), not this tool),
`INVALID_TRANSITION` (a `legacy` event — the old-platform import is
[#1879](https://github.com/doctor-school/ds-platform/issues/1879)) and
`RESOURCE_NOT_FOUND` (no event with that id or slug). The backfill never writes
`live_at`, `starts_at`, `state` or `origin`.

Running it against **production** is a separate, owner-gated operation — the
manifest is reviewed and the dry-run output accepted before the real run.

## Owning ADRs

- **ADR-0002** — backend core stack (NestJS + Zod + REST + SDK).
- **ADR-0003** — data layer (Postgres 17 + Drizzle + pgvector), via `@ds/db`.
- Feature specs live in `apps/docs/content/specs/features/` (003 auth, webinars).

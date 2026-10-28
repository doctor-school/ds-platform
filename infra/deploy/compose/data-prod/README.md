# data-prod compose

`compose.yml` is the persistence plane for the 003 slice (pre-pilot deploy slice
spec §2.2, §3, §6.3), apply-ready (DSO-100). Its content is **JSON**: JSON is valid
YAML, so `docker compose -f compose.yml` reads it unchanged, and
`tools/deploy/postgres-guard.mjs` parses it with `JSON.parse` — the prod release
driver runs `prod.mjs --local` from a bare codeload tree with no node_modules
(#3157). JSON carries no comments, so the rationale lives here. Prettier ignores
the file (`.prettierignore`) so it is never rewritten as YAML.

## Host and ports

PRIVATE host: published ports bind to the VPC interface ONLY, never `0.0.0.0`.
Set `VPC_IP` to data-prod's private address (`var.data_prod_private_ip`, default
`192.168.0.10`) before `up` (the `infra/deploy/README.md` apply step, or a `.env`
beside the compose file):

```bash
VPC_IP=192.168.0.10 docker compose -f compose.yml up -d
```

Both `postgres` (5432) and `redis` (6379) publish on `${VPC_IP}` only.

A release does this itself: its `data-env` writes `.env` here and its `data-up` raises
the persistence plane, then GlitchTip (`glitchtip/compose.yml`, project
`ds-glitchtip`, with this same `.env` passed as `--env-file`; `infra/deploy/README.md`
→ GlitchTip). A hand-made `glitchtip/.env` does not survive the next ship.

## Secrets

Via `/etc/ds-platform/data.env`, never committed: `POSTGRES_PASSWORD`, the
pgbackrest S3 credentials (`PGBACKREST_REPO1_S3_KEY` / `_KEY_SECRET` —
Terraform-generated, copied via `terraform output -raw`, spec §5.4 DD-6),
bucket/endpoint/region, and the repo cipher passphrase
(`PGBACKREST_REPO1_CIPHER_PASS`). `postgres` reads it for `POSTGRES_PASSWORD` and
the `PGBACKREST_*` values its `archive_command` needs for WAL egress; `pgbackrest`
reads the `PGBACKREST_*` values.

## Services

- **postgres** — a pgvector + pg_partman + pgbackrest build (`postgres/Dockerfile`):
  `pgvector/pgvector:pg17` + `postgresql-17-partman` (parity with the dev-stand
  data-layer image, `infra/dev-stand/postgres/Dockerfile`) + pgbackrest, built
  on-box, no registry. The pgvector requirement (ADR-0003) is the decisive reason
  for self-hosted PostgreSQL over Managed PG (spec §3); pg_partman backs the
  `audit_ledger` partitioning migration (`apps/api/drizzle/0004`); pgbackrest is
  embedded so `archive_command` can push WAL. Mounts: `init.sql` creates `vector`
  and `partman` on a FRESH cluster (Zitadel creates its own `zitadel` database via
  the admin credentials on first boot — no init here, dev-stand parity);
  `pgsocket` is shared with the pgbackrest sidecar.
- **redis** — `redis:7-alpine` with AOF (`--appendonly yes`, ADR-0003 §8).
- **pgbackrest** — a small on-box build: `postgres:17-bookworm` (uid-999 parity +
  libpq/gosu) + pgbackrest + cron. Daily full at 02:30 MSK (`TZ=Europe/Moscow`, so
  it fires in the maintenance window) + incremental every 6 h; `retention-full=7`;
  repo cipher AES-256-CBC; continuous WAL archive (postgres `archive_command`).
  The entrypoint runs `stanza-create` (idempotent), then cron in the foreground
  (spec §6.3). It mounts `pgdata` read-only to read PGDATA files during backup and
  connects to postgres through the shared socket.

## Guard contract

`postgres-guard.mjs` checks the raw file strictly: exact short-form volume strings;
`extends`, `tmpfs` and `volumes_from` are refused. Any byte change to this file, or
to the `postgres/` and `pgbackrest/` build contexts, changes the PostgreSQL source
hash and needs an artifact certification (`tools/deploy/README.md`).

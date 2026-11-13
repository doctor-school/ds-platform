# DS Platform — prod data-layer Postgres 17 image (data-prod, DSO-100 spec §2.2/§3).
#
# Parity with the dev-stand data-layer image (infra/dev-stand/postgres/Dockerfile —
# the SSOT for the pgvector + pg_partman contract): SAME pgvector base + SAME
# pg_partman package, so `vector(...)` (ADR-0003 §3.2, readiness probe) and the
# native monthly audit_ledger partitioning (apps/api/drizzle/0004) work identically
# in prod. Adds pgbackrest so Postgres's archive_command can push WAL to Timeweb S3
# (spec §6.3) — the dev-stand needs no backups, so this layer is prod-only.
#
# Reproducible from git — no manual `docker exec` install step. Built by
# `tools/deploy/postgres-artifact-prepare.mjs` on the approved build host and
# certified before release (tools/deploy/README.md).
#
# Build inputs are pinned (#3992): the base by digest (PostgreSQL 17.11, bookworm —
# the dev-stand digest, #4026), pg_partman and pgbackrest by exact package version.
# Unpinned, a rebuild installs whatever PGDG publishes that day: the two prod
# containers ended up on different pgBackRest builds, and PGDG's pg_partman
# 5.5.0-1.pgdg12+2 (Depends: postgresql-17 >> 17.12) no longer installs on the
# 17.11 base. PGDG keeps earlier builds in the bookworm-pgdg index alongside the
# newest one (`apt-cache madison <package>`).
# Bump together: the base digest with a pg_partman build whose `postgresql-17`
# Depends the new base satisfies (`apt-cache show postgresql-17-partman`), and
# PGBACKREST_PACKAGE together with the one in ../pgbackrest/Dockerfile — both
# containers read the same repository, so they run the same pgBackRest. Locked
# buckets need pgBackRest >= 2.59.2 (infra/deploy/RECOVERY.md §1.4).
FROM pgvector/pgvector:pg17@sha256:7d0a41464797aeb9862dfdc0bbf1526b82cfd324cdd8036df19e3545f4a9ccb8

ARG PGBACKREST_PACKAGE=2.60.0-1.pgdg12+1

# ca-certificates is REQUIRED alongside pgbackrest: the pgvector/pg17 (bookworm)
# base ships no TLS trust store, so archive_command's pgbackrest cannot verify the
# (publicly-valid GlobalSign) cert on the Timeweb S3 endpoint — WAL archiving fails
# with error 19 "self-signed certificate in certificate chain" (DSO-100 on-box find:
# pg_stat_archiver showed 0 archived / 51 failed with no CA bundle present).
# The last step fails the build unless the pgbackrest on PATH is the pinned version.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       postgresql-17-partman=5.5.0-1.pgdg12+1 \
       "pgbackrest=${PGBACKREST_PACKAGE}" \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && v="$(pgbackrest version)" \
    && { [ "$v" = "pgBackRest ${PGBACKREST_PACKAGE%%-*}" ] \
         || { echo "pgbackrest on PATH is '$v', pinned ${PGBACKREST_PACKAGE}" >&2; exit 1; }; }

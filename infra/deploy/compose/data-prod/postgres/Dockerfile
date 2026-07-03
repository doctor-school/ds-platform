# DS Platform — prod data-layer Postgres 17 image (data-prod, DSO-100 spec §2.2/§3).
#
# Parity with the dev-stand data-layer image (infra/dev-stand/postgres/Dockerfile —
# the SSOT for the pgvector + pg_partman contract): SAME pgvector base + SAME
# pg_partman package, so `vector(...)` (ADR-0003 §3.2, readiness probe) and the
# native monthly audit_ledger partitioning (apps/api/drizzle/0004) work identically
# in prod. Adds pgbackrest so Postgres's archive_command can push WAL to Timeweb S3
# (spec §6.3) — the dev-stand needs no backups, so this layer is prod-only.
#
# Reproducible from git — no manual `docker exec` install step. Built ON-BOX (the
# workstation has no Docker); first `docker compose build` is the verification gate.
FROM pgvector/pgvector:pg17

# pg_partman (mirror dev-stand) + pgbackrest, both from the base's configured apt
# sources (PGDG + Debian bookworm). Unpinned on purpose — PGDG/Debian rotate old
# patch versions out of the index, so an exact `=` pin breaks the build the moment
# a new patch ships (dev-stand Dockerfile precedent). Tested classes: pg_partman
# 5.4.x, pgbackrest 2.5x (bookworm).
# ca-certificates is REQUIRED alongside pgbackrest: the pgvector/pg17 (bookworm)
# base ships no TLS trust store, so archive_command's pgbackrest cannot verify the
# (publicly-valid GlobalSign) cert on the Timeweb S3 endpoint — WAL archiving fails
# with error 19 "self-signed certificate in certificate chain" (DSO-100 on-box find:
# pg_stat_archiver showed 0 archived / 51 failed with no CA bundle present).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-partman pgbackrest ca-certificates \
    && rm -rf /var/lib/apt/lists/*

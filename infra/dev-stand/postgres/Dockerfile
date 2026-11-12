# DS Platform — Postgres 17 data-layer image (SSOT for dev-stand AND prod).
#
# Extends the upstream pgvector image (ADR-0003 §2.6 / §3.2 — first-class
# `vector(...)`) with pg_partman (ADR-0003 §2.6 / §2.7) so the native monthly
# RANGE partitions on `audit_ledger` (#367) can be auto-created and retained by
# the #136 retention follow-up. Both extensions MUST coexist.
#
# This Dockerfile is the single image source:
#   - dev-stand — `infra/dev-stand/compose.core.yml` builds it (`build:` →
#     `image: ds-platform/postgres:pg17-partman`).
#   - prod data layer — the deploy pipeline builds + pushes the same Dockerfile
#     to the registry; the prod Postgres runs this image so pgvector + pg_partman
#     are present in every environment (engineering-readiness data-layer plan).
#
# Reproducible from git — no manual `docker exec` install step (the #369 AC).
#
# Build inputs are pinned (#4026): the base by digest (PostgreSQL 17.11, bookworm)
# and pg_partman by exact package version. Unpinned, PGDG published
# 5.5.0-1.pgdg12+2 (Depends: postgresql-17 >> 17.12), which the 17.11 base cannot
# install. Bump both together: pick a partman build whose `postgresql-17` Depends
# the new base satisfies (`apt-cache show postgresql-17-partman`).
FROM pgvector/pgvector:pg17@sha256:7d0a41464797aeb9862dfdc0bbf1526b82cfd324cdd8036df19e3545f4a9ccb8

# pg_partman from PGDG (apt.postgresql.org is already configured in the
# pgvector/postgres base — `/etc/apt/sources.list.d/pgdg.list`). PGDG keeps
# earlier builds in the bookworm-pgdg index alongside the newest one.
# 5.5.0-1.pgdg12+1 is the build the last green CI image installed (#4026).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-partman=5.5.0-1.pgdg12+1 \
    && rm -rf /var/lib/apt/lists/*

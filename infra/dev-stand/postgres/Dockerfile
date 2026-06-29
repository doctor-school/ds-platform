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
FROM pgvector/pgvector:pg17

# pg_partman from PGDG (apt.postgresql.org is already configured in the
# pgvector/postgres base — `/etc/apt/sources.list.d/pgdg.list`). Unpinned on
# purpose: PGDG rotates old patch versions out of its index, so an exact `=`
# pin would break the build the moment a new patch ships. Tested with
# 5.4.3-1.pgdg12+1 (bookworm, 2026-06).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-partman \
    && rm -rf /var/lib/apt/lists/*

-- DS Platform data-prod — Postgres init (DSO-100 spec §2.2). Parity with the
-- dev-stand init (infra/dev-stand/postgres/init.sql), minus the dev-only `unleash`
-- schema (Unleash is out of slice — spec §8).
--
-- Runs once, on FIRST cluster initialisation, via the postgres image entrypoint
-- (/docker-entrypoint-initdb.d/). The ds_prod database is created by POSTGRES_DB
-- before this runs; the script executes inside ds_prod. The `zitadel` database is
-- NOT created here — Zitadel creates its own on first boot using its admin creds
-- (dev-stand parity). Idempotent (IF NOT EXISTS) so a manual re-run on an existing
-- volume is safe.

-- pgvector (ADR-0003 §3.2) — the readiness probe checks `to_regtype('vector')`.
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_partman (ADR-0003 §2.6/§2.7) — declarative monthly RANGE partition
-- auto-creation for audit_ledger. Migration 0004 also creates these IF NOT EXISTS
-- (self-sufficient), but seeding them here means the pg_partman_bgw worker
-- (postgresql.conf shared_preload_libraries) has its schema present from first
-- boot. The `postgresql-17-partman` binary ships in the image (Dockerfile).
CREATE SCHEMA IF NOT EXISTS partman AUTHORIZATION ds;
CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman;

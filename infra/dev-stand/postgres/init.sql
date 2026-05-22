-- DS Platform dev-stand — Postgres init (PORTABLE CONTRACT)
--
-- Runs once, on first cluster initialisation, via the official postgres image
-- entrypoint (/docker-entrypoint-initdb.d/). The ds_dev database is created by
-- the POSTGRES_DB env var before this script runs; the script executes inside
-- ds_dev and enables the pgvector extension required by ADR-0003.
--
-- Idempotent — IF NOT EXISTS guards a manual re-run against an existing volume.

CREATE EXTENSION IF NOT EXISTS vector;

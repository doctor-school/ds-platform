-- DS Platform dev-stand — Postgres init (PORTABLE CONTRACT)
--
-- Runs once, on first cluster initialisation, via the official postgres image
-- entrypoint (/docker-entrypoint-initdb.d/). The ds_dev database is created by
-- the POSTGRES_DB env var before this script runs; the script executes inside
-- ds_dev and enables the pgvector extension required by ADR-0003.
--
-- Idempotent — IF NOT EXISTS guards a manual re-run against an existing volume.

CREATE EXTENSION IF NOT EXISTS vector;

-- Unleash (#184) keeps its tables in a dedicated `unleash` schema inside this
-- shared database (no separate database; see compose.core.yml → unleash). Create
-- it up-front on a fresh cluster so the very first Unleash boot migrates cleanly
-- (Unleash pins its connection search_path to this schema). On an EXISTING volume
-- this script does not re-run, so the operator pre-creates the schema once by hand
-- (README → Feature flags); the IF NOT EXISTS guard makes that safe.
CREATE SCHEMA IF NOT EXISTS unleash AUTHORIZATION ds;

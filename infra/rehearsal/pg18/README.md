# PostgreSQL 18 synthetic cluster rehearsal

Issue #2135 is the executable database-only slice of #2131 / #2101. The design is
[PostgreSQL 18 migration](../../../apps/docs/content/specs/tech/2026-09-09-postgresql-18-migration-en.md).
This runner accepts no production connection, credential or input dump. It creates
synthetic data on an explicitly selected SSH Docker host. Active production,
development and staging image defaults remain PostgreSQL 17.

## Run

From a clean committed worktree with Node and SSH available:

```text
node tools/deploy/pg18-rehearsal.mjs SSH_ALIAS RUN_ID ABS_AUDIT_JSONL ABS_EVIDENCE_JSON
node --test tools/deploy/pg18-rehearsal.test.mjs
```

Resolve the SSH alias from the local stand recipe. The host must provide
non-interactive `sudo docker`, Linux amd64-compatible candidate images, registry
and APT access for image construction, and sufficient task storage. The runner
reads Docker's actual storage root; it does not assume `/var/lib/docker`.

Every remote invocation and SQL input is appended to the audit JSONL **before**
execution. Audit write failure prevents the invocation. The audit contains only
synthetic fixture SQL and infrastructure commands; do not repurpose this entrypoint
for production data. Image building precedes the internal network: runtime
containers have no published ports, and the task network is Docker `--internal`.
Backup/restore helper containers use no network and resource limits.

Names and labels identify `ds-pg18-2135-RUN_ID`. An absence check rejects re-entry;
an atomic, retained Docker container-name lease prevents two invocations from
initializing the same namespace concurrently. Interrupted runs require a **new**
run ID, never an in-place repair or duplicate initialization. Persistent container
IDs returned by this invocation are stopped on exit; an invocation rejected at
the absence gate cannot stop an earlier run's containers.

## What is exercised

- Four databases (`postgres`, `ds_prod`, `zitadel`, `glitchtip`) hold synthetic SQL
  fixtures. The last two names do **not** mean their actual services ran. The
  migration discovers every non-template database rather than filtering to the
  application database.
- Roles, memberships and grantors; database owner, ACL, comment, locale/encoding,
  database settings and role-in-database settings; table/default privileges,
  constraints and NOT NULL semantics, retained rows, identity sequence, vector
  query/index presence, case-insensitive `citext` behavior, large-object bytes and
  pg_partman configuration/partition maintenance with retention disabled.
- PG17 full and incremental backups, WAL archive check, and recovery to a named
  restore point between committed `before` and `after` markers in **every** DB.
- PG18-client globals/custom archives, strict logical restore into a separate
  checksum-enabled PG18 volume, and complete fixture integrity comparison.
- The same full/incremental/WAL/named-target PITR drill on PG18 with independent
  repository storage; the earlier marker must exist and the later one must not.
- Database-level Phase A: restart the retained restored PG17 endpoint and compare
  its complete fixture integrity. Phase B: restore the latest PG18 incremental
  backup into another fresh PG18 target and prove **both** acknowledged markers
  survive. A reverse PG18-to-PG17 downgrade is untested and unavailable.

Backups really execute in a separate, one-shot sidecar with read-only PGDATA and a
shared socket. It uses the **same immutable image ID** as the server, guaranteeing
the tested pgBackRest binary and OS-user parity. This does not certify the
production scheduler/cron image lifecycle. PG17 mounts its data path; PG18 mounts
the parent `/var/lib/postgresql` with nested `PGDATA=/var/lib/postgresql/18/docker`.
Startup asserts the path and `PG_VERSION`. No PG17 volume is mounted into PG18.

## Bootstrap and cross-version comparisons

The original bootstrap superuser is retained so PG18 restores `GRANTED BY`
semantics. The globals replay validates and removes exactly one expected
`CREATE ROLE source_admin;` conflict; all other statements run with
`ON_ERROR_STOP=1`.

For the pre-existing `postgres` database, the runner extracts database-level
metadata from the archive's full `--create` TOC. It validates and removes exactly
one expected `CREATE DATABASE postgres ...;` statement, then strictly replays
archive-derived owner, comment, ACL and settings before restoring its objects.
Other databases use strict `pg_restore --create`. No restore error is ignored.

ACL arrays are compared as sorted complete sets, preserving NULL versus empty.
PG18 adds first-class NOT NULL catalog constraints, so both majors are compared
through `attnotnull`, with other constraint definitions compared separately.
Exact extension versions are asserted independently and included in evidence.
`citext` is logically recreated from PG17 1.6 to PG18 1.8; the available update path
and case-insensitive behavior are checked. **No `ALTER EXTENSION UPDATE` execution
is claimed.** Both synthetic servers use vector 0.8.6 and pg_partman 5.5.0; this is
not evidence for the production vector 0.8.4 / partman 5.4.3 transition.

## Recorded run

[2026-09-09 evidence](./evidence-2026-09-09.json) records clean executable commit
`76ad7fd2`, exact base digests, local built image IDs, package/extension versions,
integrity hashes, backup labels, system identifiers, LSNs and recovered timelines.
PG17 was 17.11, PG18 was 18.6, and pgBackRest was 2.59.1. Promote these same built
artifacts if later certified; mutable tags or rebuilding against APT are not an
artifact promotion procedure.

The authoritative cluster identity is the exact SQL-text `recovered.systemId`
string. Raw runner output parses pgBackRest JSON numbers with native JavaScript
precision; its numeric `system-id` field can round and must not be used as an
identity gate. Those numeric fields are omitted from the committed sanitized
evidence, with the limitation recorded there.

| Measured stage                 | Seconds |
| ------------------------------ | ------: |
| PG17 full/incremental/WAL/PITR |  44.940 |
| Logical 17 to 18 and integrity |  32.545 |
| PG18 full/incremental/WAL/PITR |  45.051 |
| Phase B PG18 forward recovery  |  25.584 |
| Phase A retained PG17 restart  |   8.060 |

These are small synthetic-fixture timings, including SSH/container overhead,
not a production downtime estimate. Evidence includes `du -sk` allocated KiB for
five data volumes and both repositories on the host filesystem; it does not
establish production peak scratch/WAL/growth capacity or an approved margin.

The runner retains task volumes, images, stopped containers, internal networks
and lease for review/recovery. There is no automatic volume deletion. Any later
cleanup must inspect the exact run label and resource names, journal commands
before execution and remove only those task resources. Never use volume/system
prune, shared-stand reset, live-volume edits or raw destructive database SQL.

## Remaining gates

#2131 retains the protected representative RF restore; real application
migrations/read-write/outbox/idempotency flows; Zitadel login/token and GlitchTip
ingest/read; production extension transition; scheduled sidecar lifecycle;
ordinary deployment major/path/identity guard; full capacity/downtime proposal;
and safe artifact promotion. #2101 retains owner-approved environment cutovers.
This PR neither closes either parent nor authorizes production writes, traffic
switching, cluster replacement or a downgrade.

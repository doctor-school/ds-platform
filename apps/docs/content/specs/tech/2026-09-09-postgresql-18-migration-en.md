---
title: "PostgreSQL 18 cluster migration design [EN]"
description: "Reviewed migration boundary for Issue 2101: isolated rehearsal, cluster preservation, backup continuity and explicit production cutover."
lang: en
status: Draft
tracker: "GitHub Issue #2133 (design), #2131 (preparation), #2101 (migration)"
---

# PostgreSQL 18 cluster migration

**EN (this)** · [RU](./2026-09-09-postgresql-18-migration-ru.md)

## 1. Scope and authorization

Issue #2101 coordinates PostgreSQL 17 → 18 across production, development, staging, extensions and backups. This is a proposed migration design, not evidence of implementation or a production approval. The owner's “Приступай к 2101” authorizes preparation. Production write freeze, cluster replacement and any transfer of production data require the applicable explicit authorization after the evidence package is complete.

ADR-0003 remains the accepted running PostgreSQL 17 decision until the reviewed migration records its production transition. Preserve its full-cluster durability, retained-row policy, private-network boundary and v1 RTO ≤2 hours / RPO ≤15 minutes. For this planned cutover, the stricter acceptance criterion is **zero lost acknowledged writes**. A historical restore duration in the deploy README is not a measurement for this upgrade.

## 2. Observed repository boundary

| Consumer           | Current source                                                                                                      | Coordinated target contract                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Production server  | `infra/deploy/compose/data-prod/postgres/Dockerfile`: `pgvector/pgvector:pg17`, `postgresql-17-partman`, pgbackrest | Tested PG18 server, vector and PG18 partman binaries; embedded pgbackrest compatible with the sidecar   |
| Development server | `infra/dev-stand/postgres/Dockerfile`: PG17 vector + partman                                                        | Same PostgreSQL and extension versions as production                                                    |
| Staging            | `infra/deploy/compose/stg-infra/compose.yml` builds the development image                                           | Same version contract; separately migrated persistent cluster                                           |
| Backup sidecar     | `infra/deploy/compose/data-prod/pgbackrest/Dockerfile`: `postgres:17-bookworm` + pgbackrest                         | Tested PG18 client, pgbackrest version and matching OS UID/GID/socket access                            |
| Persistent storage | Production/staging and development mount the cluster at `/var/lib/postgresql/data`                                  | New named PG18 volume mounted at `/var/lib/postgresql`, explicit `PGDATA=/var/lib/postgresql/18/docker` |
| Backup path        | `[ds] pg1-path=/var/lib/postgresql/data`, repository `/pgbackrest`                                                  | PG18 stanza uses `pg1-path=/var/lib/postgresql/18/docker`; old PG17 archive remains recoverable         |

The file inventory is separate from live evidence. Read-only inventory on 2026-09-09 found PG17.11, `en_US.utf8` collation/ctype, checksums off, `pg_partman_bgw` preload; database sizes: `ds_prod` 13,129,395 bytes, `zitadel` 21,763,763, `glitchtip` 108,353,203 and `postgres` 7,665,331. Application extensions: citext 1.6, pg_partman 5.4.3, pg_trgm 1.6, plpgsql 1.0, vector 0.8.4. Disk free was 68 GB; this is an initial capacity observation, not the rehearsal result. pgBackRest reported OK and current full/incremental backups; historical archive failures are not evidence of a present failure. Record actual server version, image IDs/digests, extensions in **every database**, database/role/tablespace inventory, encoding/locale/collation provider/version, checksum state, replication slots/subscriptions, prepared transactions and external writers before choosing executable parameters. Include `ds_prod`, `zitadel`, `glitchtip`, `postgres` and any additional discovered databases; never infer cluster completeness from the application database alone.

Resolve immutable base digests and exact built output digests for server, development and sidecar; retain tested PG17 images. Capture `postgres --version`, package versions, `pgbackrest version`, `pg_extension` and extension update paths in a sanitized manifest. The current unpinned APT build means a base digest alone is insufficient: promote the **same built artifact**, with its package inventory, instead of rebuilding at cutover. Verify registry availability, architecture and PostgreSQL 18 minor version at implementation time; no invented future digest or untested version pin belongs here.

## 3. Chosen migration technique

Choose **offline full-cluster logical export/restore using PG18 clients into a distinct PG18 volume**, subject to the measured rehearsal gates below. The read-only 2026-09-09 inventory reports a 160.1 MB cluster: logical rebuild avoids dual-major extension binaries and checksum matching complexity at this scale. Freeze all databases together; capture globals with `pg_dumpall --globals-only` and every non-template database with PG18 `pg_dump` custom archives, then restore roles/tablespaces before per-database objects/data using PG18 `pg_restore`. Reconcile bootstrap-role conflicts explicitly in the tested orchestrator, never ignore restore errors. Preserve database attributes, owners, ACLs/default privileges, memberships, sequences, large objects and extension configuration. Inventory template customizations and restore them explicitly if present.

| Alternative                      | Assessment                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image replacement over PG17 data | Invalid major upgrade; startup refusal or unexpected empty-cluster initialization is unacceptable                                                                                             |
| `pg_upgrade --link`              | Rejected: starting the new cluster compromises independence of the retained old data                                                                                                          |
| `pg_upgrade --copy`              | Viable fallback if logical downtime exceeds the measured window; adds dual-major binaries and extension/locale/checksum compatibility gates. Requires a revised reviewed procedure before use |
| Logical replication              | Not selected: additional coordination for IdP, DDL, sequences and extension state is unnecessary until outage measurement proves offline migration unsuitable                                 |

Restore into a freshly initialized PG18 cluster with explicitly recorded locale/encoding and checksums enabled, then validate all extension objects and update paths. PG17 currently has checksums disabled; logical restore permits this transition. A future physical-copy alternative must match checksum settings and pass `pg_upgrade --check`. Run statistics refresh and any required index rebuild before performance checks. Keep application/IdP/GlitchTip/schema versions fixed during this database-major migration to bound compatibility and rollback.

## 4. Rehearsal and evidence

Use a separately named project, private network, volumes, sockets and backup prefix. Never use the shared dev database, production volume, production archive push credentials or production endpoints for rehearsal. Production data stays within approved RF infrastructure; use a synthetic representative fixture for initial automation. A representative protected production restore needs separately authorized access and stays in the approved environment. No dump is downloaded to a workstation or attached to GitHub.

1. Inventory real sizes and growth using read-only evidence. Seed initial fixtures with application and Zitadel databases, roles/memberships/grants, ownership/default privileges, sequences, large objects if present, vector indexes, partition configuration and retained/tombstoned rows.
2. Exercise PG17 full + incremental backup and WAL recovery. Restore to a target between two deterministic committed markers: earlier marker present, later marker absent. Include writes in both application and IdP databases. Prove archive continuity and record cluster system identifier, backup labels, target time/LSN and recovered timeline without credentials or personal rows.
3. Upgrade the isolated restored cluster via the exact export/restore procedure. Compare database/object inventories, counts and privacy-safe integrity summaries; validate constraints, sequence values, extension versions, vector query/index behavior and pg_partman maintenance with partition dropping disabled.
4. Exercise real application migrations against the candidate without mixing schema changes into the upgrade; verify application reads/writes, retained rows, outbox/idempotency, and actual Zitadel startup/login/token flows and GlitchTip ingest/read flows in isolation. Disable external notifications/payments and production integrations; a health endpoint alone does not prove IdP compatibility.
5. Create a PG18 full backup and incremental/WAL sequence in a separate test prefix, restore a fresh PG18 cluster and repeat marker PITR and application/IdP checks. PG17 WAL is not a PG18 recovery source.
6. Rehearse both rollback phases in §7, including acknowledged writes made after PG18 activation. No forward-only happy-path acceptance.

Measure backup/restore, freeze/drain, logical export/restore, extension/index/statistics work, validation, endpoint switch, rollback export/import and warm-up separately. Record dataset/volume/WAL sizes, available disk/inodes and peak temporary use. The capacity gate must cover retained PG17 + PG18 + migration scratch + growth/WAL reserve + rollback target concurrently; the measured worst case plus declared margin must fit. The owner receives a bounded downtime and rollback window derived from these results. Missing figures mean **not ready for cutover**, not zero.

## 5. Backup continuity and target layout

Do not rename or move the production PG17 data in place. Retain its named volume, immutable image, configuration, credentials reference and original backup metadata/WAL chain for the recorded rollback retention window. Explicitly prevent scheduled expiration from removing required PG17 backups/WAL during that window; do not change the lifetime of unrelated repositories.

Use a new PG18 stanza and distinct repository prefix for this logical backup boundary. Wire the server's `archive_command`, backup wrapper, sidecar entrypoint/schedule and configuration to the same PG18 stanza/path; hardcoded `ds` consumers must be inventoried and migrated together. Do not silently run the PG17 scheduler against PG18 or invoke `stanza-upgrade` as an unreviewed shortcut. The new stanza creates a new full backup; validate archive push/check and fresh restore before writes reopen. Preserve the old chain independently and demonstrate a PG17 restore after the PG18 backup starts.

Mount the parent volume consistently in server and sidecar (sidecar data mount read-only), with `pg1-path` pointing to the nested PG18 directory. Verify actual base-image `PGDATA`, declared volume, UID/GID, socket and entrypoint behavior by image inspection and execution. Assert `PG_VERSION=18` in the intended directory and absence of a second accidentally initialized cluster. Never let an ordinary restart initialize a blank replacement for an existing environment.

## 6. Production cutover sequence after approval

1. Pin approved code and all image digests. Record actual source cluster fingerprint and restore evidence; confirm old/new capacity, backup health, recovery keys access and approved maintenance/abort deadline. No unrelated Redis, network or server replacement.
2. Enter maintenance and block **all writers**: application/API jobs, queue consumers, scheduled tasks, IdP, GlitchTip web/workers, direct DB clients and deployment/provisioning jobs. Drain requests and transactions; verify no remaining writer or prepared transaction. A read-only application page is not a complete write freeze.
3. Finish final PG17 checkpoint/backup and WAL archival; while the source is running but every writer is frozen, export globals and all databases and verify the archives. Record the final committed boundary, then stop the source cleanly. Protect old volume and archive against writes/expiration. Recheck identity/path assertions immediately before migration.
4. Execute the previously rehearsed restore from those verified frozen-state archives into the new volume. Any failure before PG18 writes follows rollback phase A. Start PG18 only on the private validation endpoint; run integrity/extension checks and initial full backup plus archive check.
5. Switch application, IdP and GlitchTip together to the candidate. Controlled validation writes make the cutover enter rollback phase B. Keep public traffic closed until the same accepted app/IdP checks and current backup verification pass. Open writers only within the approved deadline; measure first acknowledged write boundary.
6. Monitor errors, locks, latency, connection use and WAL/backup health through the agreed observation window. Retain PG17 resources and reverse-restore capacity until the authorized cleanup date. Record deployed cluster/image versions and evidence; issue completion requires actual environment convergence, not only merged pins.

## 7. No-data-loss rollback

**Phase A — no PG18 writes, including internal/IdP writes:** stop candidate, restore the complete old configuration/endpoint mapping and resume the untouched PG17 cluster. Prove the source was not modified by migration and matches the final committed boundary. Do not restore an earlier backup and discard acknowledged source transactions.

**Phase B — any PG18 writes:** the old PG17 volume is stale. Restarting it or restoring a pre-cutover backup would lose data and is forbidden. Freeze every writer again; preserve the complete PG18 cluster and its final WAL/backup. The preferred recovery is repair forward on PG18 or an application-only rollback compatible with PG18.

If a return to PG17 is required, use only a **previously rehearsed full logical reverse restore** from the frozen PG18 state into a fresh PG17 target, including roles, all databases and post-cutover sequence/IdP state. PostgreSQL does not guarantee newer-version dump output loads into an older server: this path is conditional on exact-version testing and retained PG17-compatible schema/extension features. Compare complete integrity summaries and acknowledged post-cutover markers before reconnecting either application or IdP. No manual SQL deletion of incompatible objects, skipped restore errors, partial database rollback or lossy downgrade is permitted. If reverse rehearsal fails, PG17 downgrade is unavailable: the approval package must name the proven PG18 recovery path and measured time; otherwise cutover remains blocked.

## 8. Ordinary deployment guard and delivery gates

Implement a fail-closed pre-mutation guard in the canonical deployment path. Read the running server major, source cluster identity, target image major and declared mount/path contract. Unknown/unreachable/mismatched evidence or a major transition without the approved migration record must stop **before** compose recreation, backup stanza mutation, initialization or migration. An environment variable such as `ALLOW_UPGRADE=true` is not sufficient authorization. The dedicated migration entrypoint binds the reviewed artifact, source fingerprint, target digest, rehearsal evidence and owner approval; recheck after drift.

TDD must demonstrate refusal of PG18 image over a PG17 volume, missing PGDATA, unintended new empty cluster, sidecar/path mismatch, changed source identity and absent approval; allow ordinary same-major deploys and only the exact certified transition. Test interrupted steps/re-entry and partial cutover without duplicate initialization. Full lint, static/live preflight, independent review and green CI remain required.

Integrate with PR #2128's staging deployment/configuration changes by reviewing its actual landed interfaces before touching shared paths. This is an integration check, not a fabricated technical dependency. Design may land before production changes; do not activate PG18 compose defaults while ordinary deploy could recreate PG17. Track any required deferred production action explicitly under repository release policy, scoped to the actual migration.

## 9. Open measured prerequisites and completion

Still required: live sanitized baseline; tested immutable artifact manifest; extension upgrade matrix; approved representative restore environment/data access; exact executable migration and freeze inventory; measured capacity/downtime; two-phase recovery evidence; owner cutover approval. This document does not claim any is complete.

Close #2101 only after development/staging and production reach the verified target, backup/PITR and app/IdP checks pass, rollback evidence/retention is recorded and ADR-0003 plus operational runbooks reflect the running version. Stage 1 delivers design only; implementation and production remain separate evidence gates.

## References

- [ADR-0003](../../adr/0003-data-layer-stack-en.md), especially cluster durability and retained-row policy.
- [Engineering readiness §4](./2026-05-12-engineering-readiness-design-en.md): restore and PITR are separate drills.
- [Deployment runbook](../../../../../infra/deploy/README.md): pre-migrate checkpoint and app-only versus database rollback; historical commands are not the major-upgrade procedure.
- [PostgreSQL 18 upgrading](https://www.postgresql.org/docs/18/upgrading.html), [PG18 release notes](https://www.postgresql.org/docs/18/release-18.html), [official PG18 Dockerfile](https://raw.githubusercontent.com/docker-library/postgres/master/18/bookworm/Dockerfile), [pgBackRest guide](https://pgbackrest.org/user-guide.html). Candidate extension/image versions still require actual manifest and execution verification.

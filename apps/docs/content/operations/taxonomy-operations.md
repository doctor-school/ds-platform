---
title: "Taxonomy directions operations"
description: "Verification and recovery for the curated directions book and its managed specialty and adjacency relations."
lang: en
---

# Taxonomy directions operations

This runbook covers the open, operator-maintained `directions` book and its two
managed relation families: `direction_specialties` and
`direction_adjacency`. Canon: [Feature 017 design](../specs/features/017-doctor-shell-specialties/017-design.md)
§9 and ADR-0016 §5. The **Tech Lead / System Architect** owns deployment checks;
the **platform administrator** owns editorial lifecycle and relation changes.

## Ownership boundary

| Surface                 | Write owner                                                      | Lifecycle                                                              |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `directions`            | Platform administrator through `/v1/admin/directions`            | `draft → published → retired`; restore returns the same row to `draft` |
| `direction_specialties` | Platform administrator through `/v1/admin/direction-specialties` | `active ↔ retired` on the retained pair                                |
| `direction_adjacency`   | Platform administrator through `/v1/admin/direction-adjacency`   | `active ↔ retired` on the retained directed edge                       |
| `specialties_minzdrav`  | Provenance-stamped database seed only                            | Closed book; admin and storefront reads only                           |

The `topics` table and standalone admin row family were renamed to `directions`
in place. Existing direction ids, slugs, versions and publication timestamps
must survive the migration. The already-shipped `event_topics` API/table nouns
remain their own compatibility surface and resolve against the renamed rows.

The Minzdrav list being visible in the admin application does not make it
editable. There is no create, edit, delete or import API for that book. A new or
amended nomenclature is a reviewed seed/migration change, never an operator SQL
edit.

## Post-deploy verification

Resolve the API base URL from the deployment environment or health record; do
not hardcode a local stand host. Use an ordinary authenticated admin session for
the UI/API checks and do not print session, CSRF or idempotency values in logs.

1. Confirm the API boots without a migration or audit-attachment error.
2. Open the directions list with no status filter. Draft and published rows may
   appear; retired rows must be absent. Requesting `status=retired` must expose
   retained rows, and detail by stable id must still resolve one.
3. Open the Minzdrav specialties admin list. It must match the public specialty
   read and expose no write affordance.
4. For one direction, verify the specialty-link list can be scoped by direction
   or specialty. For one adjacency edge, verify the list can be scoped by its
   source or adjacent direction. A retired relation appears only when that
   status is requested and still resolves by id.
5. Read a direction detail and retain its issued `ETag`. Publish uses that
   version directly. Retire or restore first loads
   `GET /v1/admin/directions/:id/lifecycle-impact?transition=...`, presents the
   affected active relations, and confirms with the returned impact token plus
   the previewed `ETag`.

Every state-changing request also carries a fresh canonical `Idempotency-Key`.
An exact retry may replay its stored response; reusing the key for different
input is a conflict and is not a recovery mechanism.

## Retained-row signals

- No direction or relation surface has a `DELETE` route.
- Retiring a direction preserves its id, slug and first-publication timestamp;
  restoring it updates that row to `draft`, after which publication is a
  separate deliberate command.
- Retiring either relation preserves its id and endpoint pair. Creating the
  same pair again is refused; restore the retained row instead.
- Relation creation requires active endpoints. A retired direction must be
  restored before a specialty link or adjacency edge can be authored for it.
- Direction retirement impact includes active specialty links and adjacency
  edges that stop resolving. Retired incident relations are not shown as newly
  affected, but they remain part of the signed fingerprint so a concurrent
  restore invalidates the preview.

## Recovery by signal

| Signal                            | Meaning                                                                                 | Recovery                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `PRECONDITION_REQUIRED` (428)     | The write omitted the row version.                                                      | Reload detail and retry with the newly issued `ETag`.                                             |
| `PRECONDITION_FAILED` (412)       | The row changed after it was read.                                                      | Reload detail; re-evaluate the intended change; use a fresh idempotency key.                      |
| `LIFECYCLE_IMPACT_REQUIRED` (428) | A direction retire/restore skipped its preview.                                         | Load the matching lifecycle-impact transition and show it before confirmation.                    |
| `LIFECYCLE_IMPACT_STALE` (412)    | The direction or an incident relation changed after preview.                            | Reload detail and impact; confirm only the newly displayed set with a fresh key.                  |
| `INVALID_TRANSITION` (409)        | The requested lifecycle move no longer applies.                                         | Reload status; restore a retired row or publish a restored draft as separate actions.             |
| `RELATIONSHIP_CONFLICT` (409)     | A pair already exists, an endpoint is retired, or the edge violates its endpoint rules. | Open the existing retained relation and restore it when retired; otherwise correct the endpoints. |

Do not recover by deleting rows, changing status columns directly, recreating a
retired pair, or editing the Minzdrav table. Those actions bypass optimistic
concurrency, lifecycle-impact confirmation and the audit ledger.

# 010 — Universal edit audit (scenarios)
# Companion to 010-requirements.md / 010-design.md. Backend-only: scenarios are
# exercised as Vitest e2e against dev-stand Postgres + apps/api — no browser run.

Feature: Universal edit audit — WHO / WHEN / WHAT / SOURCE for every domain-table mutation
  Every INSERT/UPDATE/DELETE of an audited domain table appends one append-only
  audit_ledger row (event_type data.<table>.<op>) carrying the actor, timestamp,
  changed-fields-only diff, and source — through any write path, with PD masked
  and a CI guard forbidding silent opt-out.

  Background:
    Given the audit trigger function is attached to every audited domain table by migration
    And the audit_ledger append-only enforcement trigger is active

  # --- Happy path: attributed API mutation (EARS-1, EARS-2, EARS-3, EARS-5, EARS-6)

  Scenario: An authenticated admin edit lands a fully attributed field-level trail row
    Given an authenticated platform_admin with Zitadel sub "admin-sub-1"
    And a published event whose title is "Кардиология 2026" and description is unchanged since creation
    When the admin updates the event title to "Кардиология 2026 — осень" through the API
    Then exactly one audit_ledger row with event_type "data.events.update" is appended in the same transaction
    And its subject_id is "admin-sub-1"
    And its metadata.source is "admin-ui"
    And its metadata.diff contains only the "title" field with old "Кардиология 2026" and new "Кардиология 2026 — осень"
    And the diff contains neither the unchanged "description" field nor the "updated_at" bookkeeping column
    And metadata carries the table name, the row pk, and the transaction id

  # --- Direct DB access is audited, not blocked (EARS-4)

  Scenario: A direct SQL write with no audit context still leaves an honest trail row
    Given a psql session on the dev stand with no app.actor_sub or app.source set
    When the session updates a registration row with a raw UPDATE statement
    Then the domain write succeeds
    And one audit_ledger row with event_type "data.registrations.update" is appended
    And its metadata.source is "db-direct"
    And its subject_id is NULL
    And no actor is fabricated

  # --- DELETE reconstructibility (EARS-2)

  Scenario: Deleting a row captures the full old row in the diff
    Given an existing event row with a full field set
    When the row is deleted through any write path
    Then one audit_ledger row with event_type "data.events.delete" is appended
    And its metadata.diff carries every column of the deleted row as {field: {old: value}}
    And the deleted record is reconstructible from that diff alone

  # --- No-op suppression (EARS-2)

  Scenario: An update that changes nothing leaves no trail row
    Given an existing event row
    When an UPDATE writes the same values back (only updated_at is touched)
    Then no audit_ledger row is appended for that statement

  # --- PD masking (EARS-7)

  Scenario: A PD-column change is recorded as masked, never in plaintext
    Given the users table is registered as PD-bearing with "email" among its PD columns
    When an authenticated API request changes a user's email
    Then one audit_ledger row with event_type "data.users.update" is appended
    And its metadata.diff records the "email" field as {masked: true}
    And no plaintext old or new email value appears anywhere in the ledger row
    And non-PD columns changed in the same statement diff normally with old and new values

  # --- Append-only trail (EARS-6)

  Scenario: A trail row cannot be rewritten or removed
    Given an existing audit_ledger row with event_type "data.events.update"
    When an UPDATE or DELETE is attempted against that ledger row
    Then the statement is refused by the append-only enforcement trigger
    And a correction can only be expressed as a new compensating record

  # --- API-path actor guarantee (EARS-5)

  Scenario: An authenticated mutation can never surface as db-direct
    Given the sweep of authenticated mutating API endpoints
    When each endpoint performs its domain write in the test harness
    Then every resulting data.* ledger row carries a non-NULL subject_id
    And a source from the closed set that is not "db-direct"
    And an endpoint whose write bypasses the audit-context wrapper fails the suite

  # --- Coverage guard (EARS-8)

  Scenario: A new table cannot silently opt out of auditing
    Given a fixture schema declaring a new domain table with no audit trigger attachment and no allowlist entry
    When the audit-coverage lint runs in CI
    Then the check fails red naming the uncovered table
    And it passes only when the table gains a trigger-attach migration line or an allowlist entry carrying a recorded rationale

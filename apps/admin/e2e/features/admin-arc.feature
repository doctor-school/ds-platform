# 007 — the operator journey in the Refine admin app, translated from
# 007-scenarios.feature to the browser surface via playwright-bdd. The api-level
# guarantees (single source of truth, one audit row per transition, the 006 player
# instantiation) are asserted in the apps/api Vitest e2e; HERE we drive exactly what
# the operator sees and does in the running admin UI on the live dev stand — the
# required user-facing deliverable (requirements Verification, `all` row).

Feature: Minimal event admin — one operator creates, streams, runs, and archives a webinar

  @EARS-1 @EARS-3 @EARS-4 @EARS-5 @EARS-6 @happy
  Scenario: One operator runs a webinar end to end, from creation to archive
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    Then the event is shown in the "draft" state
    And only the "publish" lifecycle action is offered
    When the operator configures the stream with provider "rutube"
    And the operator publishes the event
    Then the event is shown in the "published" state
    When the operator opens the room
    Then the event is shown in the "live" state
    When the operator closes the room
    Then the event is shown in the "ended" state
    When the operator archives the event
    Then the event is shown in the "archived" state
    And no lifecycle action is offered

  @EARS-7 @failure
  Scenario: The admin UI offers only the transitions valid from the current state
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    Then only the "publish" lifecycle action is offered
    And no invalid transition action is offered from draft

  @EARS-3 @failure
  Scenario: The stream provider is a closed enum — nothing outside rutube|youtube can be chosen
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    Then the stream provider choices are exactly rutube and youtube

  @EARS-10 @happy
  Scenario: Absolute admin times render in МСК regardless of the operator's timezone
    Given a platform_admin operator in the admin app
    When the operator creates a draft event at "2026-07-17T19:00" МСК with a program PDF
    Then the event air time renders as "19:00" МСК in the admin list
    And no untranslated catalog key is visible on the surface

  @EARS-8 @failure
  Scenario: A non-admin caller cannot reach the admin surface
    Given a doctor_guest caller with a session
    When the caller opens the events page
    Then the caller is bounced to the login screen

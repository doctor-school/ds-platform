# 005 — the registration JOURNEY on the live portal, translated from
# 005-scenarios.feature to the browser surface via playwright-bdd. The api-level
# guarantees (the one-registration invariant EARS-3, the durable roster EARS-8, the
# return-target guard) are asserted in the apps/api Vitest e2e + the portal unit
# tests; HERE we drive exactly what the doctor sees and does in the running portal
# on the live dev stand — the required user-facing deliverable (requirements
# Verification, the `all` row): guest → «Участвовать» → 003 auth → returns
# registered → «мои события» → back to the event page, plus logged-in one-tap and
# ended/archived gating. The whole run rides a deliberately non-Moscow browser
# timezone (playwright.config `bdd` project), so the МСК labels prove no
# viewer-local drift globally (EARS-11), not just in one tagged step.
#
# Seeded fixture events (005↔007 fixture seam, parent #564): the journey drives the
# `seed-005-*` events (apps/api/scripts/seed-events.ts). "Done against the real
# dependency" = the journey runs on events authored + transitioned through 007.

Feature: 005 Webinar registration journey — guest through auth to «мои события», one-tap, and lifecycle gating

  Background:
    Given the live dev stand is available

  # --- The full guest → auth → registered → «мои события» → back journey (US-2/US-3/US-4) ---

  @EARS-2 @EARS-4 @EARS-6 @EARS-11 @happy
  Scenario: A guest registers through auth and finds the event in «мои события»
    Given a guest on the published event page
    When the guest activates «Участвовать»
    And the guest completes the feature-003 signup flow
    Then the guest lands back on that same event page in the registered state
    And the register CTA is no longer offered
    When the doctor opens «мои события»
    Then the just-registered event is listed, linking back to its event page
    And every listed time is labeled МСК with no drift to the viewer timezone
    When the doctor opens the listed event from «мои события»
    Then the doctor is back on that event page in the registered state

  # --- Logged-in one-tap registration (US-1) ---

  @EARS-1 @happy
  Scenario: A logged-in doctor registers in one tap on a second event
    Given a logged-in doctor on a second, not-yet-registered published event page
    When the doctor activates the one-tap «Участвовать» command
    Then the event page immediately shows the registered state
    And the register CTA is no longer offered

  # --- Register-during-live (US-1, EARS-9: live is a registrable state) ---
  # The Stage-B rework finding (#574/#673): on a LIVE event «Участвовать» must FIRE
  # the registration and flip the page to the registered state — never navigate to
  # the not-yet-built 006 room (a 404) and never lose the registration. The onward
  # room affordance for a registered doctor arrives with the room itself (#584).

  @EARS-1 @EARS-9 @happy
  Scenario: A logged-in doctor registers in one tap on a LIVE event — no 404, no lost registration
    Given a logged-in doctor on the live, not-yet-registered event page
    When the doctor activates the one-tap «Участвовать» command
    Then the event page immediately shows the registered state
    And the doctor is still on that live event page, not a 404
    And the register CTA is no longer offered

  @EARS-2 @EARS-9 @happy
  Scenario: A guest's «Участвовать» on a LIVE event leads into the auth flow, never a 404
    Given a guest on the live event page
    When the guest activates «Участвовать»
    Then the guest is taken into the auth flow carrying that live event, not a 404

  # --- Lifecycle gating (US-1/US-2) ---

  @EARS-9 @failure
  Scenario Outline: Ended and archived events offer no register affordance
    Given the "<state>" event page
    Then no register affordance is offered

    Examples:
      | state    |
      | ended    |
      | archived |

  # --- Cross-cutting: the per-user surface is authenticated (US-5) ---

  @EARS-10 @failure
  Scenario: «Мои события» and the per-user reads require authentication
    Given a guest with no session
    When the guest opens «мои события»
    Then the guest is redirected to the login screen
    And the MyEvents read is refused without a session
    And the EventRegistrationState read is refused without a session
    And the RegisterForEvent command is refused without a session

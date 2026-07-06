# 005 — Event registration & «мои события» scenarios
# Gherkin for the write side of the Webinars epic wave 1 (registration on top of auth 003 +
# the registered state on the event page + the «мои события» account surface).
# Happy paths + failure branches. Translated to Playwright via playwright-bdd — this is a
# user-facing spec, so the browser run is a required deliverable (owned + tracked by the 005
# portal-integration + E2E child Issue, open-ears-issues step 3a), not a bare footnote.
# Tags map scenarios to EARS handlers in 005-requirements-en.md; each EARS realizes a US-N in 005-product.md.

Feature: Webinar registration — a doctor registers, sees the registered state, and finds it in «мои события»

  Background:
    Given the portal serves the webinar surfaces on its configured origin
    And the auth foundation (feature 003) is available for login and signup
    And the public event page and «Участвовать» CTA (feature 004) are available
    And the event read model is seeded with events in each lifecycle state
    And all times are presented in Europe/Moscow labeled МСК

  # --- Logged-in one-tap registration (US-1, US-3) ---

  @EARS-1 @EARS-4 @happy
  Scenario: A logged-in doctor registers in one tap and the page reflects it immediately
    Given a logged-in doctor on a published (upcoming) event page
    When the doctor activates «Участвовать»
    Then a registration is recorded against the doctor's account in one action
    And the event page immediately shows the registered state instead of the register CTA

  @EARS-5 @happy
  Scenario Outline: The registered event page signposts how and when to join
    Given a doctor registered for an event in the "<state>" state
    When the doctor opens the event page
    Then the page shows the "<signpost>" join signposting
    And the register CTA is not shown

    Examples:
      | state     | signpost                         |
      | published | start date and time (МСК)        |
      | live      | onward path toward the room      |

  # --- Guest through auth (US-2) ---

  @EARS-2 @happy
  Scenario: A guest completes registration through auth without losing the event context
    Given a guest on a published event page
    When the guest activates «Участвовать»
    And the guest passes the feature-003 login or signup flow
    Then the registration for that same event completes
    And the guest lands back on that event page in the registered state
    And the guest never has to re-find the event or tap «Участвовать» a second time

  @EARS-2 @failure
  Scenario: The registration-intent rejects an unsafe return target
    Given a guest activating «Участвовать» with a tampered cross-origin return target
    When the registration-intent is validated
    Then the cross-origin return target is rejected
    And no PII or credential is carried in the event context

  # --- The one-registration invariant (US-1, US-5) ---

  @EARS-3 @happy
  Scenario: Registering twice yields a single registration
    Given a doctor already registered for an event
    When the doctor registers for the same event again through any path
    Then no duplicate registration is created
    And the response returns the existing registration as a no-op
    And no second registration event or audit entry is emitted

  # --- Registration state vs the public page (US-3) ---

  @EARS-4 @EARS-10 @happy
  Scenario: The event page never shows the register CTA to an already-registered doctor
    Given an authenticated doctor who is registered for an event
    When the doctor opens the event page
    Then the page shows the registered state
    And the register CTA is not shown as if the doctor were unregistered

  @EARS-4 @EARS-10 @edge
  Scenario: The public event page stays identical for guest and principal
    Given a published event
    When a guest and a logged-in principal each request the public event page
    Then the public page body is identical for both
    And the doctor's registration state is served only by a separate authenticated read
    And the public page and its shared cache carry no per-user registration state

  # --- «Мои события» (US-4) ---

  @EARS-6 @EARS-11 @happy
  Scenario: «Мои события» lists the doctor's registered upcoming events, nearest first
    Given a doctor registered for several upcoming events and some ended events
    When the doctor opens «мои события» (the Предстоящие tab)
    Then only the registered upcoming events are listed, ordered nearest first
    And each item shows date and time (МСК), title, school/series, and a link to its event page
    And ended, archived, and other doctors' registrations are absent

  @EARS-7 @happy
  Scenario: A just-registered event appears in «мои события» immediately
    Given a doctor who has just registered for an event
    When the doctor opens «мои события»
    Then the just-registered event is present in the list

  @EARS-6 @EARS-12 @failure
  Scenario: «Мои события» shows an empty-state when nothing is registered
    Given a doctor with no registered upcoming events
    When the doctor opens «мои события»
    Then a clear "no upcoming registered events" empty-state is rendered
    And the surface is neither blank nor broken

  # --- Recording & gating (US-5, US-1, US-2) ---

  @EARS-8 @happy
  Scenario: A registration is durably recorded as the basis for admission and the roster
    Given a doctor registers for an event
    When the registration is recorded
    Then it is durably stored server-side against the doctor's account
    And it becomes part of the event roster that room admission (feature 006) and the sponsor report draw from
    And the record carries no registrant PII on any public surface

  @EARS-9 @happy
  Scenario: Register-during-live is a normal path
    Given a logged-in doctor on a live event page
    When the doctor activates «Участвовать»
    Then the registration is recorded
    And the page leads straight toward the room (feature 006)

  @EARS-9 @failure
  Scenario Outline: Registration is not offered for ended or archived events
    Given an event in the "<state>" state
    When a doctor opens the event page
    Then no register affordance is shown
    And a direct registration command for that event is refused

    Examples:
      | state    |
      | ended    |
      | archived |

  # --- Cross-cutting (US-1, US-4, US-5) ---

  @EARS-10 @failure
  Scenario: A doctor cannot read another doctor's registration state or the roster
    Given two doctors and an event one of them is registered for
    When the other doctor requests the first doctor's registration state, «мои события», or the roster
    Then no other doctor's registration data is returned
    And the registration command and per-user reads require authentication

  @EARS-11 @happy
  Scenario: «Мои события» times render in МСК regardless of the viewer's timezone
    Given a viewer whose browser timezone is not Europe/Moscow
    When the viewer opens «мои события»
    Then every date and time is presented in Europe/Moscow labeled МСК
    And no time drifts to the viewer's local timezone

  @EARS-13 @happy
  Scenario Outline: The registered surfaces render to the vendored canvas at both breakpoints and themes
    Given the registered event-page state and the «мои события» surface
    When they render at the "<breakpoint>" breakpoint in the "<theme>" theme
    Then the layout matches the vendored neo-brutalist canvas geometry
    And no arbitrary Tailwind value is used (token-lint green)

    Examples:
      | breakpoint | theme |
      | desktop    | light |
      | desktop    | dark  |
      | mobile     | light |
      | mobile     | dark  |

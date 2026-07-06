# 007 — Minimal event admin scenarios
# Gherkin for the authoring vertical of the Webinars epic wave 1 (create/edit an event, configure
# the stream from an explicit provider enum, drive the single event state machine
# draft → published → live → ended → archived, open/close the live room). Happy path = the full
# arc one operator/director runs for the 2026-07-17 webinar; plus failure branches. Translated to
# Playwright via playwright-bdd against the Refine admin app — this is a user-facing spec, so the
# browser run is a required deliverable (owned + tracked by the 007 admin-integration + E2E child
# Issue, open-ears-issues step 3a), not a bare footnote.
# Tags map scenarios to EARS handlers in 007-requirements-en.md; each EARS realizes a US-N in 007-product.md.

Feature: Minimal event admin — one operator creates, publishes, streams, runs, and archives a webinar

  Background:
    Given the admin app is served on its configured origin with a platform_admin session (feature 003)
    And the object storage (MinIO/Timeweb) is available for the program PDF
    And the event lifecycle is a single EventLifecycleState with the closed set draft → published → live → ended → archived
    And all absolute times are entered as МСК and stored as one canonical instant
    And the public event page and listing (feature 004), registration (feature 005), and the room (feature 006) read the state 007 writes

  # --- The full happy-path arc (US-1 → US-5) ---

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-5 @EARS-6 @happy
  Scenario: One operator runs a webinar end to end, from creation to archive
    Given a platform_admin operator in the admin app
    When the operator creates an event with title, school, date and time in МСК, description, ordered free-text speakers, target specialties, a program PDF, and a sponsor reference
    Then the event is created in the draft state
    And the event is not publicly reachable
    When the operator uploads the program PDF
    Then the program PDF is stored in object storage and referenced on the event
    When the operator configures the stream with provider "rutube" and an embed reference
    And the operator publishes the event
    Then the event transitions to published
    And the event becomes publicly reachable and registration opens
    When the director opens the room on air day
    Then the event transitions to live
    And registered doctors are admitted to the room and presence capture starts
    When the director closes the room after the broadcast
    Then the event transitions to ended
    And room admission and heartbeat acceptance stop and the presence window is bounded
    When the operator archives the ended event
    Then the event transitions to archived
    And the event leaves all public surfaces

  # --- Event authoring (US-1) ---

  @EARS-1 @happy
  Scenario: A created event starts in draft and stores one canonical instant for a МСК time
    Given a platform_admin operator in the admin app
    When the operator creates an event with a date and time entered as МСК
    Then the event is created in the draft state
    And the entered МСК time is stored as one canonical instant
    And the event is absent from every public surface until it is published

  @EARS-1 @happy
  Scenario: Speakers are stored as an ordered list of free-text entries in wave 1
    Given a platform_admin operator creating an event
    When the operator adds speakers as ordered name and regalia text entries
    Then the speakers persist in order as free-text entries
    And no reference to a real user or speaker record is required in wave 1

  # --- Edit + program PDF replacement (US-2) ---

  @EARS-2 @happy
  Scenario: Replacing the program PDF after publish serves the current file on the public page
    Given a published event with a program PDF
    When the operator uploads a replacement program PDF
    Then the stored program PDF reference is updated
    And the public event page (feature 004) serves the current file
    And the superseded file is no longer served
    And the operator did not have to unpublish to make the change

  # --- Stream configuration (US-3) ---

  @EARS-3 @happy
  Scenario Outline: The stream is configured from an explicit provider enum
    Given a platform_admin operator configuring the stream of an event
    When the operator selects provider "<provider>" and sets an embed reference
    Then the stream config records provider "<provider>" and the embed reference
    And the room (feature 006) instantiates the player from exactly this config, never from the URL

    Examples:
      | provider |
      | rutube   |
      | youtube  |

  @EARS-3 @failure
  Scenario: An unknown stream provider is rejected at configuration time
    Given a platform_admin operator configuring the stream of an event
    When the operator submits a provider outside the closed enum rutube | youtube
    Then the stream configuration is rejected
    And no stream config is recorded for the unknown provider

  @EARS-3 @happy
  Scenario: A wrong stream URL is correctable while the event is published
    Given a published event whose stream config has the wrong embed reference
    When the operator corrects the embed reference before opening the room
    Then the updated stream config is recorded
    And no state reversal (unpublish) was needed

  # --- Lifecycle transitions & the closed set (US-4, US-5) ---

  @EARS-4 @happy
  Scenario: Publish is refused unless the event is in draft
    Given an event that is already published
    When the operator attempts to publish it again
    Then the publish is refused
    And the event stays in its current state

  @EARS-5 @happy
  Scenario: Opening and closing the room are the live and ended transitions
    Given a published event on air day
    When the director opens the room
    Then the event transitions to live and the room admits registered doctors
    When the director closes the room
    Then the event transitions to ended and admission and heartbeat acceptance stop

  @EARS-6 @happy
  Scenario: Archiving is a manual operator action with no scheduler
    Given an ended event
    When the operator archives it
    Then the event transitions to archived and leaves all public surfaces
    And no scheduler or time-based automation archived it

  @EARS-7 @failure
  Scenario Outline: An invalid lifecycle jump is refused server-side and never offered in the UI
    Given an event in the "<from>" state
    When a jump to "<to>" is attempted
    Then the transition is refused server-side
    And the admin UI never offered that transition from the "<from>" state

    Examples:
      | from      | to        |
      | draft     | live      |
      | draft     | ended     |
      | published | ended     |
      | archived  | published |
      | live      | published |

  @EARS-7 @failure
  Scenario: There is no unpublish transition
    Given a published event
    When an attempt is made to move it back to draft
    Then the transition is refused
    And no published-to-draft path exists in the closed transition set

  # --- Cross-cutting: authorization (US-1..US-5) ---

  @EARS-8 @failure
  Scenario Outline: A non-admin caller cannot author or transition an event
    Given a caller whose role is "<role>"
    When the caller attempts an authoring write or a lifecycle transition
    Then the request is refused
    And no event is created, edited, or transitioned

    Examples:
      | role         |
      | doctor_guest |
      | public       |

  @EARS-8 @happy
  Scenario: The produced public projection stays publicly readable
    Given a published event authored in the admin
    When a public caller requests the event page projection (feature 004)
    Then the public event projection is returned without authentication
    And no admin-only or operator field is exposed

  # --- Cross-cutting: single source of truth (US-1..US-5) ---

  @EARS-9 @happy
  Scenario Outline: Admin state is exactly what the portal surfaces reflect
    Given an event that the operator has moved to the "<state>" state
    When the admin display and the portal surfaces are read for that event
    Then both resolve the same EventLifecycleState "<state>"
    And there is no second visibility flag to reconcile

    Examples:
      | state     |
      | draft     |
      | published |
      | live      |
      | ended     |
      | archived  |

  # --- Cross-cutting: МСК copy (US-1, US-2, US-3) ---

  @EARS-10 @happy
  Scenario: Absolute admin times render in МСК regardless of the operator's timezone
    Given an operator whose browser timezone is not Europe/Moscow
    When the operator views the event list and detail
    Then every absolute date and time is presented in Europe/Moscow labeled МСК
    And no time drifts to the operator's local timezone
    And no user-facing string is hardcoded outside the message catalog

  # --- Cross-cutting: stock Refine, no canvas (US-1) ---

  @EARS-11 @happy
  Scenario: The admin surface is built on stock Refine with no canvas-fidelity gate
    Given the admin app for the events resource
    When the admin surface is built
    Then it uses stock Refine components with the adopt-before-bespoke gate recorded
    And token discipline (no arbitrary Tailwind) holds for any bespoke styling
    And there is no canvas-fidelity check because no admin canvas exists (Stage-A gap)

# 004 — the public webinar DISCOVERY journey on the live portal, translated from
# 004-scenarios.feature to the browser surface via playwright-bdd. The api-level
# guarantees (the publish-safe projection EARS-1/2/10, the visibility policy
# EARS-6, the nearest-first ordering EARS-7) are asserted in the apps/api Vitest
# e2e; the per-EARS render pins live in the sibling plain-`@playwright/test` specs
# (event-page.e2e.spec.ts, webinars-listing.e2e.spec.ts, listing-consistency.e2e.spec.ts).
# HERE we drive the CONNECTED user journey no single handler owns — the requirements
# Verification `all` row: a guest opens a sponsor-distributed direct link → reads
# the page → opens the listing → clicks a card → back, across the upcoming / live /
# ended / archived lifecycle states. The whole run rides a deliberately non-Moscow
# browser timezone (playwright.config `bdd` project, America/New_York), so the МСК
# labels prove no viewer-local drift globally (EARS-12), not just in one tagged step.
#
# Seeded fixture events (004↔007 fixture seam, parent #549): the journey drives the
# shared seeded lifecycle events (apps/api/scripts/seed-events.ts), read by slug from
# env. "Done against the real dependency" = the journey runs on events authored +
# transitioned through 007, at which point the seed is retired.

Feature: 004 Public webinar discovery — a guest reads an event page and scans upcoming broadcasts

  Background:
    Given the live dev stand is available

  # --- The connected discovery arc: direct link → read → listing → card → back (US-1/US-4) ---

  @EARS-1 @EARS-8 @happy
  Scenario: A guest opens a sponsor link, reads the page, scans the listing, and returns via a card
    Given a guest opens the seeded upcoming event by its direct link
    Then the full event page is server-rendered without authentication
    And the page carries the title, a МСК start time, and one «Участвовать» CTA
    When the guest opens the upcoming-broadcasts listing
    Then the seeded upcoming event appears as a card labeled МСК
    When the guest activates that listing card
    Then the guest lands on that same event's page
    When the guest navigates back to the listing
    Then the upcoming-broadcasts listing is shown again

  # --- Lifecycle renders from the single state machine (US-6) ---

  @EARS-4 @happy
  Scenario Outline: The event page reflects each lifecycle state from the single state machine
    Given a guest opens the seeded "<state>" event by its direct link
    Then the event page hero shows the "<badge>" lifecycle signal
    And the participation affordance matches the "<state>" lifecycle state

    Examples:
      | state     | badge         |
      | published | Скоро         |
      | live      | В эфире       |
      | ended     | Эфир завершён |

  # --- Archived direct link degrades gracefully (US-5/US-6) ---

  @EARS-5 @failure
  Scenario: An archived direct link degrades to a public notice, not a dead end
    Given a guest opens the seeded archived event by its direct link
    Then the archived page is a reachable 200 on the same URL, not a 404 or a redirect
    And the «мероприятие в архиве» notice is shown with no participation CTA

  # --- Cross-surface live consistency (US-4/US-6) ---

  @EARS-9 @happy
  Scenario: A live event reads «В эфире» consistently on the card and the page
    Given the guest opens the upcoming-broadcasts listing
    Then the seeded live event's card shows the «В эфире» signal
    When the guest opens the seeded live event's page
    Then the event page shows the same «В эфире» signal

  # --- Cross-cutting: МСК presentation with no viewer-local drift (US-2/US-6) ---

  @EARS-12 @happy
  Scenario: Times render in МСК regardless of the viewer's timezone
    Given a guest opens the seeded upcoming event by its direct link
    Then every time on the page is labeled МСК with no drift to the viewer timezone
    When the guest opens the upcoming-broadcasts listing
    Then every time on the listing is labeled МСК with no drift to the viewer timezone

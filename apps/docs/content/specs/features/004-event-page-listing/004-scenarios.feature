# 004 — Public event page & upcoming-broadcasts listing scenarios
# Gherkin for the read side of the Webinars epic (public event page + listing: week view,
# month-calendar view, and the «Неделя / Месяц» switcher — wave-2 slice #701).
# Happy paths + failure branches. Translated to Playwright via playwright-bdd — this is a
# user-facing spec, so the browser run is a required deliverable (owned + tracked by the 004
# portal-integration + E2E child Issue, open-ears-issues step 3a), not a bare footnote.
# Tags map scenarios to EARS handlers in 004-requirements-en.md; each EARS realizes a US-N in 004-product.md.

Feature: Public webinar discovery — a doctor reads an event page and scans upcoming broadcasts

  Background:
    Given the portal serves the public webinar surfaces on its configured origin
    And the public event read endpoints require no authentication
    And the event read model is seeded with events in each lifecycle state
    And all times are presented in Europe/Moscow labeled МСК

  # --- Public event page (US-1, US-2, US-5) ---

  @EARS-1 @EARS-10 @happy
  Scenario: A guest opens a sponsor-distributed link and reads the full page without logging in
    Given a published event with a stable public URL
    When an unauthenticated visitor opens that URL
    Then the full event page is rendered server-side with no authentication required
    And the response body is identical to what a logged-in principal would receive

  @EARS-2 @happy
  Scenario: The event page carries the complete decision set
    Given a published event with speakers, specialties, partners, and a program PDF
    When a visitor opens the event page
    Then the page shows the title, school/series, start date and start time labeled МСК, description, speakers with credentials, target specialty chips, and backing partners
    And a downloadable program PDF link is present

  @EARS-2 @edge
  Scenario: An event with no program PDF renders the program section without a broken link
    Given a published event that has no program PDF
    When a visitor opens the event page
    Then the program section renders without a download affordance
    And no broken or empty PDF link is shown

  @EARS-3 @happy
  Scenario: The page offers exactly one «Участвовать» CTA that enters registration
    Given a published (upcoming) event
    When a guest opens the event page and activates «Участвовать»
    Then exactly one primary participation CTA is present
    And the guest enters the registration flow (feature 005) through auth (feature 003) carrying the event context

  # --- Lifecycle states (US-6) ---

  @EARS-4 @happy
  Scenario Outline: The page reflects the event's lifecycle state from the single state machine
    Given an event in the "<state>" state
    When a visitor opens the event page
    Then the hero badge, time plate, and CTA reflect the "<render>" render
    And no signal contradicts the state machine

    Examples:
      | state     | render   |
      | published | upcoming |
      | live      | live     |
      | ended     | ended    |

  @EARS-4 @failure
  Scenario: An ended event shows no dead CTA
    Given an event in the "ended" state
    When a visitor opens the event page
    Then the page states the broadcast has ended
    And no participation CTA links to a room or registration

  @EARS-9 @happy
  Scenario: A live event routes toward the room
    Given an event in the "live" state
    When a registered visitor opens the event page
    Then the page shows a "live now" signal
    And the CTA routes toward the webinar room (feature 006)

  # --- Visibility & archived links (US-5, US-6) ---

  @EARS-5 @happy
  Scenario: An archived event's distributed link degrades to a public notice, not a dead end
    Given an archived event whose direct link was previously distributed
    When a visitor opens that link
    Then a public "мероприятие в архиве" notice is rendered
    And no participation CTA is shown
    And the response is neither a 404 nor a redirect to the listing

  @EARS-6 @failure
  Scenario: A draft event is not publicly reachable
    Given a draft event
    When a visitor requests its public URL
    Then the response is not-found, indistinguishable from a non-existent event
    And the draft never appears on any public listing

  # --- Upcoming-broadcasts listing (US-4) ---

  @EARS-7 @EARS-8 @happy
  Scenario: The listing shows published upcoming events, nearest first
    Given several published events with future air dates and some past, draft, and archived events
    When a visitor opens the upcoming-broadcasts listing
    Then only published or live future-dated events are listed, ordered nearest air date first
    And each card shows date and time (МСК), title, school/series, specialties, and speakers
    And past, draft, and archived events are absent

  @EARS-8 @happy
  Scenario: A listing card navigates to its event page
    Given the upcoming-broadcasts listing with at least one card
    When a visitor activates a card
    Then the visitor lands on that event's page

  @EARS-9 @happy
  Scenario: A live event reads "live now" consistently on card and page
    Given a live event that appears on the listing
    When a visitor views its card and then its page
    Then both surfaces show the "live now" signal derived from the same state
    And neither surface contradicts the other

  @EARS-9 @edge
  Scenario: An ended event drops from the listing
    Given an event that transitions from live to ended
    When the listing is re-read
    Then that event is no longer listed

  @EARS-11 @failure
  Scenario: The listing shows an empty-state when nothing is upcoming
    Given no published or live future-dated events exist
    When a visitor opens the upcoming-broadcasts listing
    Then a clear "no upcoming broadcasts" empty-state is rendered
    And the surface is neither blank nor broken

  # --- Month view & «Неделя / Месяц» switcher (US-7, US-8, US-9) ---

  @EARS-18 @happy
  Scenario: The doctor switches the listing between week and month views and back
    Given the upcoming-broadcasts listing in its default «Неделя» view
    When the visitor activates «Месяц» and then «Неделя»
    Then the month calendar renders for the current month
    And the round-trip returns the same day-grouped week list with nothing lost
    And both views are publicly readable without authentication

  @EARS-15 @EARS-19 @happy
  Scenario: The month view shows the whole month at a glance with the live event in red
    Given a month with upcoming published events, one live event, and already-past events
    When a visitor opens the month view for that month
    Then upcoming events render as pills on the 7-column grid (dots on the mobile grid)
    And the live event renders as a red "live now" pill derived from the single state machine
    And the month's past events render as muted notes without a participation affordance
    And today is visibly marked and a legend explains the states

  @EARS-15 @failure
  Scenario: Draft and archived events never appear in the month view
    Given a month containing draft and archived events alongside published ones
    When a visitor reads the month projection
    Then only published, live, and ended events of that month are returned
    And no draft or archived event appears in the grid or in the per-month counts

  @EARS-15 @EARS-19 @edge
  Scenario: A month with only past events renders muted notes, not pills
    Given a month all of whose events have already ended
    When a visitor opens the month view for that month
    Then its days render muted past-event notes
    And no pill offers a participation affordance

  @EARS-19 @edge
  Scenario: An empty month renders a readable calendar, not a broken surface
    Given a month with no events at all
    When a visitor opens the month view for that month
    Then the calendar grid renders with no pills and no notes
    And the selected-day agenda on mobile shows the "no broadcasts this day" note

  @EARS-16 @EARS-17 @happy
  Scenario: The doctor navigates months by paging and by the picker with counts
    Given the month view for the current month
    When the visitor pages › to the next month and then picks another month in the month picker
    Then the grid and the month heading re-render for each selected month without leaving the month view
    And the picker shows a per-month event count for the displayed year with past months muted

  # --- Cross-cutting (US-1, US-2) ---

  @EARS-10 @failure
  Scenario: The public endpoints never expose non-public events or PII
    Given the public event read endpoints
    When any caller requests a draft or archived event as an active event, or inspects the projection
    Then no draft/archived-as-active body is returned
    And the projection carries no operator, commercial, or registrant-PII field

  @EARS-12 @happy
  Scenario: Times render in МСК regardless of the viewer's timezone
    Given a viewer whose browser timezone is not Europe/Moscow
    When the viewer opens the event page and the listing
    Then every date and time is presented in Europe/Moscow labeled МСК
    And no time drifts to the viewer's local timezone

  @EARS-14 @happy
  Scenario Outline: The page and card render to the vendored canvas at both breakpoints and themes
    Given the event page and a listing card
    When they render at the "<breakpoint>" breakpoint in the "<theme>" theme
    Then the layout matches the vendored neo-brutalist canvas geometry
    And no arbitrary Tailwind value is used (token-lint green)

    Examples:
      | breakpoint | theme |
      | desktop    | light |
      | desktop    | dark  |
      | mobile     | light |
      | mobile     | dark  |

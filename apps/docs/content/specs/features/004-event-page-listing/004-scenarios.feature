# 004 — Public event page & upcoming-broadcasts listing scenarios
# Gherkin for the read side of the Webinars epic (public event page + listing: week view,
# month-calendar view, and the «Неделя / Месяц» switcher — wave-2 slice #701).
# Happy paths + failure branches. Translated to Playwright via playwright-bdd — this is a
# user-facing spec, so the browser run is a required deliverable (owned + tracked by the 004
# portal-integration + E2E child Issue, open-ears-issues step 3a), not a bare footnote.
# Tags map scenarios to EARS handlers in 004-requirements-en.md; each EARS realizes a US-N in 004-product.md.

@host:academy
Feature: Public webinar discovery — a doctor reads an event page and scans upcoming broadcasts

  Rule: Public listing cards identify the event they open

    @EARS-7 @EARS-8 @happy
    Scenario: A guest discovers a golden upcoming broadcast and opens its public page
      Given the golden upcoming broadcast is publicly readable
      When the visitor opens "/webinars"
      Then the public listing is server-rendered with heading "Расписание эфиров"
      # Amended 2026-10-02 (#2537): online and hybrid events render in the viewer's timezone with an explicit zone label; offline events keep МСК. Read under 004 «Amendment — 2026-10-02».
      And the golden upcoming card shows its title, school, specialties, speaker and Moscow date and time
      When the visitor activates the golden upcoming card
      Then the visitor lands on the golden event page showing its matching title

  Rule: Public event states remain readable without participation dead ends

    @EARS-2 @edge @public-event-states
    Scenario: An event with no program PDF renders the program section without a broken link
      Given a published event that has no program PDF
      When a visitor opens the event page
      Then the program section renders without a download affordance
      And no broken or empty PDF link is shown

    @EARS-4 @failure @public-event-states
    Scenario: An ended event shows no dead CTA
      Given an event in the "ended" state
      When a visitor opens the event page
      Then the page states the broadcast has ended
      And no participation CTA links to a room or registration

    # 007 Amendment - 2026-09-02 renames archived to hidden.
    @EARS-5 @happy @public-event-states
    Scenario: A hidden event's distributed link degrades to a public notice, not a dead end
      Given a hidden event whose direct link was previously distributed
      When a visitor opens that link
      Then a public "Мероприятие скрыто" notice is rendered
      And no participation CTA is shown
      And the response is neither a 404 nor a redirect to the listing

  Rule: Public visibility excludes drafts and preserves publish-safe projections

    Background:
      Given the golden public-visibility fixtures are available

    @EARS-6 @failure @public-event-visibility
    Scenario: A draft event is not publicly reachable
      When the visitor requests the draft and an unknown public event URL
      Then both event pages render the same not-found response without draft content
      And the draft is absent from the public upcoming listing

    # 007 Amendment - 2026-09-02 renames archived to hidden.
    @EARS-15 @failure @public-event-visibility
    Scenario: Draft and hidden events never appear in the month view
      When the visitor reads the golden fixtures' calendar months
      Then those month projections contain only publicly listed lifecycle states
      And their counts equal the visible month entries without drafts or hidden events
      And the rendered month grids show the published control without the draft or hidden event

    @EARS-10 @failure @public-event-visibility
    Scenario: The public endpoints never expose non-public events or PII
      When the visitor reads the public event, upcoming and month projections
      Then the draft has no public body and the hidden event is never listed as active
      And the projections contain only publish-safe fields and source-free recording facts

  Rule: Public calendar states remain readable and navigable

    Background:
      Given the public calendar uses the supported horizon clock

    @EARS-15 @EARS-19 @edge @public-calendar-states
    Scenario: A month with only past events renders muted linked pills
      Given a golden historical month whose events have already ended
      When the visitor opens that public calendar month
      Then the historical grid renders muted linked past pills without participation states

    @EARS-19 @edge @public-calendar-states
    Scenario: An empty month renders a readable calendar, not a broken surface
      Given a far calendar month with no events and a zero year count
      When the visitor opens that public calendar month
      Then the empty desktop calendar is readable without event pills or notes
      And the mobile dot grid and selected-day agenda show no broadcasts

    @EARS-16 @EARS-17 @happy @public-calendar-states
    Scenario: The doctor navigates months by paging and by the picker with counts
      Given the public calendar month containing the horizon day
      When the visitor pages next and previous twice in the calendar
      Then every selection retains the month URL, heading and grid
      And the month picker shows all twelve API counts and a noninteractive selected marker
      And the picker distinguishes populated months, empty future months and empty archived months
      When the visitor selects another month from the calendar picker
      Then every selection retains the month URL, heading and grid

  Rule: The public feed and populated calendar share event state

    Background:
      Given the public calendar uses the supported horizon clock

    # 004 amendment 2026-10-05 replaces the week tabs with loss-free feed/month links.
    @EARS-18 @happy @public-calendar-content
    Scenario: The doctor switches the listing between feed and month views and back
      Given the guest reads the default public day-grouped feed
      When the visitor follows the calendar and feed links in both directions
      Then the current month renders and the same day-grouped feed returns with nothing lost
      And carried month, tense and facet state survive the public view round-trip

    # 004 amendment 2026-10-05 keeps past events as muted linked pills.
    @EARS-15 @EARS-19 @happy @public-calendar-content
    Scenario: The month view shows the whole month at a glance with the live event in red
      Given the current golden month contains published, live and past events
      When the visitor opens that public calendar month
      Then the desktop seven-column calendar matches the published, live and past events
      And today is outlined and the three-state calendar legend is readable
      And the mobile dots and selected-day agenda match those same events

    @EARS-9 @happy @public-calendar-content
    Scenario: A live event reads "live now" consistently on card and page
      Given the golden Academy live event is publicly readable
      When the visitor opens that live event from its listing card
      Then the live event page shows the same live signal without contradictory lifecycle copy

  Rule: Remaining public event and calendar scenarios

    Background:
      Given the portal serves the public webinar surfaces on its configured origin
      And the public event read endpoints require no authentication
      And the event read model is seeded with events in each lifecycle state
      # Amended 2026-10-02 (#2537): online and hybrid events render in the viewer's timezone with an explicit zone label; offline events keep МСК. Read under 004 «Amendment — 2026-10-02».
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
      # Amended 2026-10-02 (#2537): online and hybrid events render in the viewer's timezone with an explicit zone label; offline events keep МСК. Read under 004 «Amendment — 2026-10-02».
      Then the page shows the title, school/series, start date and start time labeled МСК, description, speakers with credentials, target specialty chips, and backing partners
      And a downloadable program PDF link is present

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

    @EARS-9 @happy
    Scenario: A live event routes toward the room
      Given an event in the "live" state
      When a registered visitor opens the event page
      Then the page shows a "live now" signal
      And the CTA routes toward the webinar room (feature 006)

    # --- Visibility & archived links (US-5, US-6) ---
    # Amended 2026-09-02 (feature 007): the `archived` state below is renamed `hidden`
    # (status "Скрыто", command "Скрыть") and `EventArchived` becomes `EventHidden`; the
    # meaning and every assertion here are unchanged. See 007-requirements-en.md ->
    # Amendment - 2026-09-02.

    # --- Upcoming-broadcasts listing (US-4) ---

    @EARS-7 @EARS-8 @happy
    Scenario: The listing shows published upcoming events, nearest first
      Given several published events with future air dates and some past, draft, and archived events
      When a visitor opens the upcoming-broadcasts listing
      Then only published or live future-dated events are listed, ordered nearest air date first
      # Amended 2026-10-02 (#2537): online and hybrid events render in the viewer's timezone with an explicit zone label; offline events keep МСК. Read under 004 «Amendment — 2026-10-02».
      And each card shows date and time (МСК), title, school/series, specialties, and speakers
      And past, draft, and archived events are absent

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

    # --- Cross-cutting (US-1, US-2) ---

    @EARS-13 @happy
    Scenario: Webinar surfaces use Russian copy from the typed message catalogue
      Given the portal uses its Russian message catalogue
      When a visitor reads the event page, listing, month calendar and their empty states
      Then labels, status badges, participation text, notices and calendar copy are rendered in Russian
      And that interface copy comes from the typed message catalogue without hardcoded component strings

    # Amended 2026-10-02 (#2537): online and hybrid events render in the viewer's timezone with an explicit zone label; offline events keep МСК. Read under 004 «Amendment — 2026-10-02».
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

  Rule: Amendment 2026-10-02 (#2537) — online and hybrid events read in the viewer's timezone; offline events keep МСК

    @EARS-12 @happy
    Scenario: An online event reads in the viewer's zone after hydration
      Given an online event starting at 19:00 МСК
      And a viewer whose browser timezone is Asia/Yekaterinburg
      When the viewer opens the event page
      Then the server-rendered page shows the start as "19:00 МСК"
      And after hydration the page shows the start as "21:00 GMT+5" without a layout shift

    @EARS-12 @happy
    Scenario: A Moscow-time viewer sees МСК on an online event
      Given an online event starting at 19:00 МСК
      And a viewer whose browser timezone is Europe/Moscow
      When the viewer opens the event page
      Then the start reads "19:00 МСК" before and after hydration

    @EARS-12 @happy
    Scenario: An offline event keeps МСК for every viewer
      Given an offline event starting at 19:00 МСК
      And a viewer whose browser timezone is Asia/Yekaterinburg
      When the viewer opens the event page and the listing
      Then the start reads "19:00 МСК" on both surfaces

    @EARS-12 @happy
    Scenario: A mixed week list groups each event under the day it shows
      Given an online event and an offline event, both starting at 01:00 МСК on 15 October
      And a viewer whose browser timezone is Europe/London
      When the viewer opens the week list
      Then the online event is grouped under 14 October and reads "23:00 GMT+1"
      And the offline event is grouped under 15 October and reads "01:00 МСК"

    @EARS-12 @failure
    Scenario: The month read rejects an unknown timezone
      Given the public month-range read
      When a caller requests a month with the zone parameter "Mars/Olympus"
      Then the read answers 400 and no events are returned

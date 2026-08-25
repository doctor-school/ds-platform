# 019 — The doctor events feed — scenarios
# Tags map every scenario to the flat EARS clauses in 019-requirements-en.md.
# This is a user-facing spec: guest and doctor journeys run through Playwright BDD
# against the real apps/doctor -> NestJS -> Postgres stack. Room state, recordings
# and registrations come from features 006 / 014 / 021, never from a seeded stand-in.
# Stage-A picks in force: F-019-1 = Б (facet sidebar / mobile sheet), F-019-2 = Б
# (month beside the feed) with its dedicated calendar page, F-019-3 = А (live block
# above the feed).

Feature: A doctor opens one screen and sees what is on now, what is on this week and what they missed

  Background:
    Given feature 017's storefront shell and specialty books are in place
    And feature 018's event card unit and managed adjacency are in place
    And the specialty «Травматология и ортопедия» exists in specialties_minzdrav
    And that specialty has upcoming and past events of every format

  @EARS-1 @happy
  Scenario: The events screen renders inside 017's shell in the canvas composition order
    Given a doctor whose remembered specialty is «Травматология и ортопедия»
    When the doctor opens «События»
    Then the header, navigation and footer are rendered by feature 017's shell layout
    And the breadcrumbs read «Травматология и ортопедия › События»
    And the view row offers Неделя / Месяц and Будущие / Прошедшие
    And the blocks appear in the order: строка вида, «Идёт сейчас», панель фасетов рядом с телом, лента по дням

  @EARS-1 @failure
  Scenario: An events route defining its own header is a defect
    Given a build in which the events route renders its own header element
    When the shell tree scan runs over the rendered route
    Then the scan reports more than one header implementation
    And the build fails review

  @EARS-2 @happy
  Scenario Outline: Every format renders through the one shared card unit
    Given an upcoming event of format "<format>" in the doctor's specialty
    When the doctor opens «События»
    Then the event renders through the shared event card unit whose anatomy feature 018 owns
    And the card shows the date, the time, the format, the kind, the speaker and the source school
    And the card shows the sign-up count of colleagues
    And no rendered string on the card states who finances the event

    Examples:
      | format         |
      | webinar        |
      | online-meeting |
      | offline-meetup |
      | congress       |
      | podcast        |

  @EARS-2 @happy
  Scenario: An offline meet-up carries its city and remaining seats everywhere it is rendered
    Given an offline colleagues' meet-up in «Казань» with 12 seats left
    When the doctor opens «События» and then the dedicated calendar page
    Then both renders of that event show «Казань» and the remaining seats
    And an event whose Pul cost is zero reads «бесплатно для врача»
    And no price in roubles appears anywhere on the screen

  @EARS-2 @failure
  Scenario: A screen-local re-implementation of the event card is a defect
    Given a build in which the events feed defines its own card component
    When the component tree scan runs over apps/doctor
    Then the scan finds an event card outside @ds/design-system
    And the build fails review

  @EARS-3 @happy
  Scenario: The feed groups by day and is targeted by the specialty and its adjacency
    Given the doctor's specialty has adjacent directions in the managed adjacency table
    When the doctor opens «События»
    Then events are grouped under their day headings within the current horizon
    And every listed event belongs to the specialty or to one of its adjacent directions
    And «показать ещё» extends the horizon and the new range is visible in the URL
    And no response field carries a ranking score or a personalisation flag

  @EARS-3 @failure
  Scenario: Adjacency is never derived from name similarity
    Given a specialty with no adjacency rows in the managed table
    When the doctor opens «События»
    Then the feed lists only events of that specialty
    And no event is included because of a shared name prefix or a computed likeness

  @EARS-4 @happy
  Scenario: The month calendar stands beside the day feed on desktop
    Given the viewport is 1440 wide
    When the doctor opens «События»
    Then the month grid and the day-grouped feed are visible at the same time
    And «Сегодня» is marked in the month grid
    And a day holding a live эфир carries the live marker
    When the doctor selects a day in the month grid
    Then the URL changes to that day
    And the feed body moves to that day without reloading the shell

  @EARS-5 @happy
  Scenario: The dedicated calendar page renders the month as the page body
    When the doctor opens the dedicated calendar page
    Then the month grid is the body of the page inside feature 017's shell
    And the page carries its own breadcrumbs, the same facet panel and the same tense controls
    And the page reads the same month contract as the in-feed grid
    When the doctor selects a day on the calendar page
    Then the doctor lands in the events feed at that day

  @EARS-5 @failure
  Scenario: A second calendar unit or a second read contract is a defect
    Given a build in which the calendar page renders its own month component
    When the tree and contract scan runs over apps/doctor
    Then more than one month unit or more than one month read contract is found
    And the build fails review

  @EARS-6 @happy
  Scenario: A registered doctor enters the live room from the block above the feed
    Given feature 006 reports an open room for an event in the doctor's specialty
    And the doctor is registered for that event
    When the doctor opens «События»
    Then the «Идёт сейчас» block is rendered above the feed with the LIVE marker, the title and the presence count
    And the block's action leads into feature 006's room

  @EARS-6 @happy
  Scenario: An unregistered reader is sent to the event page, never into the room
    Given feature 006 reports an open room for an event in the doctor's specialty
    And the reader is not registered for that event
    When the reader opens «События» and follows the live block
    Then the reader lands on feature 020's event page
    And no route into feature 006's room is reachable from the feed for that reader

  @EARS-6 @failure
  Scenario: With nothing live the block is absent rather than empty
    Given feature 006 reports no open room for any targeted event
    When the doctor opens «События»
    Then no «Идёт сейчас» container exists in the DOM
    And the layout closes over the absent block with no gap
    When the эфир that was live ends while the doctor is on the screen
    Then the block clears itself on the next refresh
    And no LIVE badge is ever derived from an event's start time in the client

  @EARS-7 @happy
  Scenario: The facet panel is the shared unit carrying the full REQ-138 set as a sidebar
    Given the viewport is 1440 wide
    When the doctor opens «События»
    Then the facet panel renders as a sidebar beside the feed body
    And it offers format, kind, specialty, city, «только с НМО», «бесплатно по Pul» and name search
    And the specialty facet defaults to «моя и смежные»
    When the doctor applies a format and a city
    Then both applied facets stay visible with the applied count and a working reset
    And the feed shows only events matching both

  @EARS-7 @happy
  Scenario Outline: The shared panel lays out correctly in every fill state
    Given the events-filter unit is mounted in the "<fill>" fill state
    When the showcase renders it at 1440 and at 390
    Then the panel and the host grid render without overflow or collapse
    And the applied-facet row and the reset stay reachable

    Examples:
      | fill         |
      | wave-1       |
      | intermediate |
      | full         |

  @EARS-8 @happy
  Scenario: Feed state round-trips through the URL
    Given the doctor has applied a format facet, switched the tense to «Прошедшие» and widened the horizon
    When the doctor copies the URL and opens it in a fresh browser context
    Then the same tense, the same facets and the same horizon are rendered
    When the doctor presses the browser back button
    Then the previous feed state is rendered rather than the doctor leaving the feed

  @EARS-8 @failure
  Scenario: Feed state held only in client memory is a defect
    Given a build in which the applied facets are stored in component state only
    When a rendered feed with applied facets is reloaded
    Then the facets are lost and the URL does not describe the screen
    And the build fails review

  @EARS-9 @happy
  Scenario: An empty facet result names the condition that emptied it
    When the doctor applies a city facet that matches no event
    Then the screen states which condition emptied it and names that city facet
    And it offers a concrete weakening of exactly that facet
    And the applied facets and the reset stay visible

  @EARS-9 @happy
  Scenario: An empty specialty offers the adjacent areas instead
    Given a doctor whose specialty has no events at all
    When the doctor opens «События» with no facets applied
    Then the screen states that the specialty has nothing yet
    And it offers the nearest events of the adjacent directions from the managed relation
    And the wording differs from the empty-facet statement

  @EARS-9 @failure
  Scenario: A failing read is contained to its own block
    Given the read behind the «Мои события» cut fails
    When the doctor opens «События»
    Then the cut states the cause in Russian and offers a retry
    And the retry re-runs only that read
    And the feed, the month grid and the facet panel stay usable
    And no page-level error screen replaces the feed

  @EARS-10 @happy
  Scenario: «Прошедшие» leads to the recording and the materials
    Given a past event whose recording feature 014 has published
    When the doctor switches the tense to «Прошедшие»
    Then the same card unit renders in its «прошло — есть запись» state
    And the card offers the recording and the published materials instead of a sign-up action

  @EARS-10 @failure
  Scenario: A past event with no recording renders without a dead link
    Given a past event for which feature 014 has published nothing
    When the doctor switches the tense to «Прошедшие»
    Then the card renders without a recording action
    And no link resolves to a missing recording
    And no community-discussion link or placeholder control is rendered anywhere in the tense

  @EARS-11 @happy
  Scenario: A signed-in doctor sees the short «Мои события» cut
    Given a signed-in doctor registered for two upcoming events
    When the doctor opens «События»
    Then a short cut lists those two events
    And «Все мои события в личном кабинете →» leads to #d-lk
    And no ticket, QR or НМО check-in is rendered in the cut

  @EARS-11 @failure
  Scenario: A guest never sees the «Мои события» block
    Given a visitor with no account
    When the visitor opens «События»
    Then the response carries no «Мои события» cut
    And no such block exists in the DOM

  @EARS-12 @happy
  Scenario: A guest reads the whole screen and returns to it after registering
    Given a visitor with no account
    When the visitor opens «События»
    Then the feed, the month grid, the calendar page, the facet panel and «Прошедшие» are fully readable
    When the visitor follows the action on a card
    Then feature 021's registration opens carrying that event and the current feed URL
    When the registration completes
    Then the doctor is returned to that exact feed URL with the action resumed on the same card

  @EARS-12 @failure
  Scenario: A gated payload is never delivered to an anonymous reader and hidden
    Given a visitor with no account
    When the anonymous read of the events feed is inspected
    Then the response carries no payload that the client hides
    And no block other than the «Мои события» cut is withheld from the guest

  @EARS-13 @happy
  Scenario: The screen works at 390 with the facet panel behind a counted control
    Given the viewport is 390 wide
    When the doctor opens «События» with two facets applied
    Then the facet panel is collapsed behind a «Фильтры» control showing the applied count
    When the doctor opens that control
    Then the panel opens as a sheet with every facet operable
    And the day feed, the month grid, the live block and the card states render in the canvas mobile composition

  @EARS-13 @happy
  Scenario: The events route and the calendar page pass the accessibility bar
    When the axe scan runs over the events route and the dedicated calendar page in both themes
    Then the scan reports no violations
    And every card is a real labelled link
    And every facet is a real control with a visible state
    And the view and tense controls are keyboard-operable
    And the LIVE state is announced to a screen reader rather than conveyed by colour alone

  @EARS-14 @failure
  Scenario: The feed contains events and only events
    When a full-text scan runs over every rendered state, breakpoint and theme of the feature
    Then no Academy news item, Academy podcast episode, partner news item or project card is present
    And the word «проект» appears in no doctor-facing string
    And no price in roubles, cart, subscription or payment affordance is present
    And no string states who finances an event
    And «партнёр» is never used as the money-carrier
    And НМО appears only as a badge and a facet, never as the screen heading or its primary filter

  @EARS-14 @happy
  Scenario: A podcast broadcast is an event of this feed rather than Academy noise
    Given an upcoming podcast broadcast in the doctor's specialty
    When the doctor opens «События»
    Then it renders as an event card of format podcast
    And no Academy podcast episode from the Academy media surface is listed beside it

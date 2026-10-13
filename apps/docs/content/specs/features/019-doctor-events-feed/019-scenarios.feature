# 019 — The doctor events feed — scenarios
# Tags map every scenario to the flat EARS clauses in 019-requirements-en.md.
# This is a user-facing spec: guest and doctor journeys run through Playwright BDD
# against the real apps/doctor -> NestJS -> Postgres stack. Room state, recordings
# and registrations come from features 006 / 014 / 021, never from a seeded stand-in.
# Stage-A picks in force: F-019-1 = Б (facet column / mobile sheet), F-019-2 = Б
# (month beside the feed), F-019-3 = А (live block above the feed).
# Read under 019 «Amendment — 2026-10-05»: there is one route; the month is a view of
# the same page reached by «Календарь на месяц →» and left by «← Лента событий», the
# head carries the tense tabs «Прошедшие | Будущие» («Будущие» by default), and the
# compact month and the facet panel sit in a sticky column at 1024 px and wider.
# Read under «— 2026-10-06» (no card action, no guest band), «— 2026-10-08» (the
# colleagues' count on upcoming and live cards only) and «— 2026-10-12» («Прошедшие»
# pages by ten events).
# Route-level scenarios tagged EARS-2/3/4/7/8/9 are integration obligations of
# EARS-1 / #1516. Their predecessor Issues prove route-independent components,
# the API contract, query state, or state matrix and do not publish `/events`.

@host:doctor
Feature: A doctor opens one screen and sees what is on now, what is on this week and what they missed

  Rule: The doctor events journeys on the golden dataset

    # Executed by the doctor project of packages/e2e against a raised slot. The facts are
    # the golden dataset's: its doctors-audience volume events, the live doctors' broadcast
    # «Идущий сейчас эфир (эталон)» and the golden doctor "verified-cardiologist", who is
    # registered for it. Dates and counts are read from the slot, never re-typed.
    # @editor-write scenarios publish and retire through the real admin, so they run
    # only on a stand whose data the run owns (E2E_ADMIN_URL set, e.g. a local branch
    # database) and skip, named, on the read-only slot run; they clean up what they made.

    @EARS-1 @EARS-3 @happy
    Scenario: A visitor reads the events screen in its composition and widens the horizon
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the page head reads «События» with the tense tabs «Прошедшие | Будущие» and «Будущие» selected
      And the blocks read in the order: the head, «Идёт сейчас», the day feed
      And the events are grouped under their day headings, nearest first
      When the visitor activates «Показать ещё»
      Then the feed extends its horizon and the new range is visible in the URL

    @EARS-11 @EARS-12 @happy
    Scenario: A guest reads the whole screen and opens an event page from a card
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the day feed, the compact month and the facet panel are readable
      And no band under the feed states that an account is needed
      And no «Мои события» block exists in the DOM
      And an upcoming card is one link to its event page with no action of its own
      When the visitor opens that upcoming card
      Then the visitor lands on that event's page showing its title

    @EARS-6 @happy
    Scenario: A registered doctor enters the live room from the block above the feed
      Given the golden doctor "verified-cardiologist" is signed in
      And the viewport is 1440 wide
      When the doctor opens «События»
      Then the «Идёт сейчас» block above the feed carries the golden doctors' broadcast with its live marker and title
      When the doctor follows the live block's action on that broadcast
      Then the doctor lands in the room of the golden doctors' broadcast

    @EARS-6 @happy
    Scenario: A guest is sent from the live block to the event page, never into the room
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the «Идёт сейчас» block above the feed carries the golden doctors' broadcast with its live marker and title
      And the live block offers no route into a room
      When the visitor follows the live block's action on that broadcast
      Then the visitor lands on the event page of the golden doctors' broadcast

    @EARS-4 @happy
    Scenario: A day picked in the compact month moves the feed to that day
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the compact month stands in the side column above the facet panel, beside the day feed
      When the visitor picks a day carrying events in the compact month
      Then the URL names that day and the feed body moves to that day without reloading the shell

    @EARS-5 @happy
    Scenario: The month is a view of the same page and keeps the tense and the facets
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События» on «Прошедшие» with the format «Онлайн» applied
      And the visitor follows «Календарь на месяц →»
      Then the month grid renders on the same route with the facet panel beside it
      And the tense «Прошедшие» and the format «Онлайн» are still applied
      When the visitor follows «← Лента событий»
      Then the day feed renders on the same route
      And the tense «Прошедшие» and the format «Онлайн» are still applied

    @EARS-7 @happy
    Scenario: A facet applied in the side panel narrows the feed and resets
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      And the visitor applies the format «Онлайн» in the facet panel
      Then the panel states «Применено: 1» with «Сбросить» and the format «Онлайн» selected
      And every card in the feed reads the format «Онлайн»
      When the visitor resets the facets
      Then no facet is applied and the URL carries none

    @EARS-8 @happy
    Scenario: Feed state round-trips through the URL
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      And the visitor applies the format «Онлайн» in the facet panel
      And the visitor activates «Показать ещё»
      And the visitor picks a day carrying events in the compact month
      And the visitor opens the same URL in a fresh browser context
      Then the same facets, the same selected day and the same horizon are rendered
      When the visitor presses the browser back button
      Then the previous feed state is rendered rather than the visitor leaving the feed

    @EARS-10 @EARS-2 @happy
    Scenario: «Прошедшие» groups past events by month and leads to a recording
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      And the visitor switches the tense to «Прошедшие»
      Then the URL carries the past tense and the past events are grouped by month, newest first
      And no «Идёт сейчас» block, «Мои события» block or archive block renders in the tense
      And no past card shows the sign-up count of colleagues
      When the visitor activates «Показать ещё» on «Прошедшие»
      Then the next older past events are added and the extent in the URL reaches further back
      When the visitor follows «Смотреть запись» on a past card
      Then the visitor lands on that event's page showing its title

    @EARS-11 @happy
    Scenario: A signed-in doctor sees the short «Мои события» cut
      Given the golden doctor "verified-cardiologist" is signed in
      And the viewport is 1440 wide
      When the doctor opens «События»
      Then the «Мои события» cut lists at most three upcoming events and none of them live
      When the doctor follows «Все мои события →»
      Then the doctor lands on "/account/events" showing "Мои события"

    @EARS-13 @happy
    Scenario: At 390 the facet panel sits behind a counted «Фильтры» control
      Given a visitor with no account
      And the viewport is 390 wide
      When the visitor opens «События» with the formats «Онлайн» and «Гибрид» applied
      Then the facet panel is collapsed behind a «Фильтры» control showing the count 2
      When the visitor opens that control
      Then the panel opens as a sheet whose facets are operable, closing on «Показать N событий»

    @EARS-14 @failure
    Scenario: The feed carries events and only events in both tenses and the month view
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the screen names no project and carries no price in roubles, cart, subscription or payment affordance
      When the visitor switches the tense to «Прошедшие»
      Then the screen names no project and carries no price in roubles, cart, subscription or payment affordance
      When the visitor follows «Календарь на месяц →»
      Then the screen names no project and carries no price in roubles, cart, subscription or payment affordance

    @EARS-16 @happy
    Scenario: The doctor feed lists doctors-audience events and never an experts-audience one
      Given the golden upcoming broadcast is publicly readable
      And a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      And the visitor widens the horizon until it reaches the golden upcoming broadcast's day
      Then the golden upcoming broadcast addressed to experts is not listed in the doctor feed
      And the «Идёт сейчас» block above the feed carries the golden doctors' broadcast with its live marker and title

    @EARS-9 @happy
    Scenario: A facet result that matches nothing names the facet whose removal finds events
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События» with the format «Онлайн» and a name search that no event matches
      Then the feed states that no event matches the name-search facet and names that facet
      And it states how many events the feed holds without that facet and offers to remove exactly that facet beside «Сбросить фильтры»
      And the applied facets and the reset stay visible in the facet panel
      When the visitor removes that facet from the empty state
      Then the feed lists events again with the format «Онлайн» still applied and no name search in the URL

    @EARS-9 @failure
    Scenario: A failing feed read is contained to its own block
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События» from a horizon start that the events read refuses
      Then the day feed states the cause in Russian and offers «Повторить»
      And the «Идёт сейчас» block, the compact month and the facet panel stay usable
      And no page-level error screen replaces the feed
      When the visitor activates «Повторить»
      Then the page re-reads in place, keeping the URL and the shell, and the day feed states the cause again

    @EARS-15 @happy
    Scenario: The doctor events screen is built from the shared module in both themes and at both breakpoints
      Given a visitor with no account
      When the visitor opens «События» at 1440 and at 390 wide, in the light and in the dark theme
      Then every rendering composes the shared events module, its cards being the design-system event card
      And the facet panel is the shared panel: a side column at 1440 and a counted «Фильтры» sheet at 390
      And the dark theme repaints the cards through the theme tokens

    @EARS-17 @happy @editor-write
    Scenario: A kind an editor publishes reaches the facet and the card with no code change
      Given an editor publishes a new event kind with a long title in the admin
      And the editor publishes a doctors-audience event of that kind starting within the hour
      And a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the kind facet offers the new kind
      And that event's card carries the new kind's label without overflowing the card, the panel or the screen grid
      When the visitor applies the new kind in the facet panel
      Then the feed lists that event under the applied kind

    @EARS-17 @failure @editor-write
    Scenario: A kind an editor retires is no longer offered
      Given an editor publishes a new event kind with a long title in the admin
      And the editor publishes a doctors-audience event of that kind starting within the hour
      And the editor retires that kind in the admin
      And a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens «События»
      Then the kind facet does not offer the retired kind

    # The run narrows the feed by name to its own events, so the kind facet counts exactly
    # the kinds this run published — the golden kinds are neither counted nor touched.
    @EARS-17 @happy @editor-write
    Scenario: The kind facet and the card label hold 9 and then 3 published kinds at both breakpoints
      Given an editor publishes 9 new event kinds in the admin, each carried by a doctors-audience event of this run starting within the hour
      And a visitor with no account
      When the visitor opens «События» narrowed by name to this run's events
      Then at 1440 and at 390 wide the kind facet holds exactly the 9 published kinds, and every card holds its kind label, without breaking the panel, the card or the screen grid
      When the editor retires 6 of those kinds in the admin
      And the visitor opens «События» narrowed by name to this run's events
      Then at 1440 and at 390 wide the kind facet holds exactly the 3 published kinds, and every card holds its kind label, without breaking the panel, the card or the screen grid

    @EARS-18 @happy
    Scenario: Both storefronts mount one events module and differ only in the cited rows
      Given a visitor with no account
      And the viewport is 1440 wide
      When the visitor opens the events screen on the doctor storefront and on the Academy
      Then both render the same shared module: the head with the tense tabs, the block order, day groups of design-system cards, the compact month and the facet panel in the column
      And the head copy differs only as the «headerCopy» row cites
      And the facet sets differ only as the «filterSet» row cites
      And the content sets differ as the «contentSet» row cites: no event is listed on both storefronts

  Rule: Remaining events-feed scenarios

    Background:
      Given feature 017's storefront shell, specialty choice and managed targeting/adjacency from #1484 are in place
      And Feature 004's shared WebinarCard unit is in place
      And Feature 004 / #1050's shared MonthCalendarGrid and MonthDotGrid units are in place
      And the specialty «Травматология и ортопедия» exists in specialties_minzdrav
      And that specialty has upcoming and past events of every format and of every seed kind of the event-kind dictionary

    @EARS-1 @happy
    Scenario: The events screen renders inside 017's shell in the canvas composition order
      Given a doctor whose remembered specialty is «Травматология и ортопедия»
      When the doctor opens «События»
      Then the header, navigation and footer are rendered by feature 017's shell layout
      And the breadcrumbs read «Травматология и ортопедия › События»
      And the page head carries the tense tabs «Прошедшие | Будущие» with «Будущие» selected by default
      And the month is reached through «Календарь на месяц →» and no «Неделя / Месяц» view control is rendered
      And the blocks read in the order: the head, «Идёт сейчас», «Мои события», the day feed, with the compact month and the facet panel in the side column at 1024 px and wider

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
      Then the event renders through Feature 004's shared WebinarCard unit widened by feature 019
      And the card shows the date, the time, the format, the kind, the speaker and the source school
      And an upcoming or live card shows the sign-up count of colleagues and a past card shows none
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
      When the doctor opens «События» and then its month view
      Then both renders of that event show «Казань» and the remaining seats
      And an event without a Pul cost shows no cost line and no free-of-charge wording
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
      Then the compact month and the day-grouped feed are visible at the same time
      And «Сегодня» is marked in the compact month
      And a day holding a live эфир carries the live marker
      When the doctor selects a day in the compact month
      Then the URL changes to that day
      And the feed body moves to that day without reloading the shell

    @EARS-5 @happy
    Scenario: The month is a view of the same page
      When the doctor opens «События» and follows «Календарь на месяц →»
      Then the month grid is the body of the same route inside feature 017's shell
      And the facet panel stays beside it with the applied facets and the tense kept
      And the month view reads the same month contract as the compact month
      When the doctor follows «+N ещё» on a day of the month grid
      Then the doctor lands in the events feed at that day
      When the doctor follows «← Лента событий»
      Then the day feed renders with the tense and the applied facets kept

    @EARS-5 @failure
    Scenario: A second calendar unit or a second read contract is a defect
      Given a build in which the month view renders its own month component
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
      And it offers format, kind, specialty, city, «только с НМО», direction and name search
      And it offers no «бесплатно по Pul» facet
      And the specialty facet defaults to «моя и смежные»
      When the doctor applies a format and a city
      Then both applied facets stay visible with the applied count and a working reset
      And the feed shows only events matching both

    @EARS-7 @happy
    Scenario Outline: The shared panel renders the facet set its host supplies
      Given the events-filter unit is mounted for the "<host>" host with several facets applied
      When the showcase renders it at 1440 and at 390
      Then the panel shows exactly the facets "<facets>" without overflow or collapse
      And the header states the applied count with a working reset
      And every picked value stays visible as a removable chip under its facet

      Examples:
        | host    | facets                                                                |
        | doctor  | name search, specialty, format, kind, city, direction, «только с НМО» |
        | academy | project, expert, topic                                                |

    @EARS-8 @happy
    Scenario: Feed state round-trips through the URL
      Given the doctor has applied a format facet, selected a day in the month grid and widened the horizon
      When the doctor copies the URL and opens it in a fresh browser context
      Then the same facets, the same selected day and the same horizon are rendered
      When the doctor presses the browser back button
      Then the previous feed state is rendered rather than the doctor leaving the feed

    @EARS-8 @failure
    Scenario: Feed state held only in client memory is a defect
      Given a build in which the applied facets are stored in component state only
      When a rendered feed with applied facets is reloaded
      Then the facets are lost and the URL does not describe the screen
      And the build fails review

    @EARS-9 @happy
    Scenario: An empty specialty offers the adjacent areas instead
      Given a doctor whose specialty has no events at all
      When the doctor opens «События» with no facets applied
      Then the screen states that the specialty has nothing yet
      And it offers the nearest events of the adjacent directions from the managed relation
      And the wording differs from the empty-facet statement

    @EARS-10 @happy
    # Read under 019 «Amendment — 2026-10-06»: the past card offers the recording only; the materials live on the recording's page.
    Scenario: «Прошедшие» leads to the recording
      Given a past event whose recording feature 014 has published
      When the doctor switches the tense to «Прошедшие»
      Then the same card unit renders in its «прошло — есть запись» state
      And the card offers «Смотреть запись» instead of a sign-up action and lists no materials
      And the past events are grouped by month, newest first
      And the screen holds the 10 most recent past events, «Показать ещё 10 (осталось N)» adding the next older ones
      And no separate archive page, tab or block below the feed is rendered

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
      Then a short cut lists those two events, at most the nearest three and no live one
      And «Все мои события →» leads into the account's «Мои события»
      And no ticket, QR or НМО check-in is rendered in the cut

    @EARS-11 @failure
    Scenario: A guest never sees the «Мои события» block
      Given a visitor with no account
      When the visitor opens «События»
      Then the response carries no «Мои события» cut
      And no such block exists in the DOM

    @EARS-12 @happy
    # Read under 019 «Amendment — 2026-10-06»: the card carries no action and no guest band renders.
    Scenario: A guest reads the whole screen and signs up on the event page
      Given a visitor with no account
      When the visitor opens «События»
      Then the feed, the month view and the facet panel are fully readable
      And no band under the feed states that an account is needed
      And an upcoming card carries no action of its own
      When the visitor opens an upcoming card
      Then feature 020's event page for that event opens, carrying its one-click sign-up

    @EARS-12 @failure
    Scenario: A gated payload is never delivered to an anonymous reader and hidden
      Given a visitor with no account
      When the anonymous read of the events feed is inspected
      Then the response carries no payload that the client hides
      And no release-1 block is withheld from the guest

    @EARS-13 @happy
    Scenario: The screen works at 390 with the facet panel behind a counted control
      Given the viewport is 390 wide
      When the doctor opens «События» with two facets applied
      Then the facet panel is collapsed behind a «Фильтры» control showing the applied count
      When the doctor opens that control
      Then the panel opens as a sheet with every facet operable
      And the day feed, the month grid, the live block and the card states render in the canvas mobile composition

    @EARS-13 @happy
    Scenario: The events route passes the accessibility bar in its feed and month views
      When the axe scan runs over the events route in its feed and month views in both themes
      Then the scan reports no violations
      And every card is a real labelled link
      And every facet is a real control with a visible state
      And the month-grid day selection is keyboard-operable
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

    @EARS-15 @happy
    Scenario: Cross-front ownership is recorded before a Doctor events slice is implemented
      Given an implementation Issue is about to change an events, calendar, facet or live-broadcast capability
      When its pre-implementation gate runs
      Then 019-design section 1.1 names the current Academy owner and canonical target for every touched capability
      And event queries delegate to EventsService and portable schemas under packages/schemas/src/events
      And room truth and entry policy delegate to RoomService and RegistrationService
      And past/archive recording truth delegates to Feature 014's RecordingsProjectionService and shared recording schemas
      And route-independent listing, calendar, card, facet and live-strip UI units are owned by @ds/design-system
      And the extraction plan migrates the Academy consumer in the same slice when its precedent is app-local
      And apps/doctor contains only its host projection, route, copy, specialty targeting and composition

    @EARS-15 @failure
    Scenario: A parallel Doctor capability fails the reuse gate
      Given a proposed Doctor slice copies an Academy component, query engine, URL-state codec, room or LIVE resolver
      When the cross-front ownership gate compares it with 019-design section 1.1
      Then the proposal is rejected before production code is written
      And a different host response envelope alone is not treated as permission to duplicate the shared core

    @EARS-14 @failure
    Scenario: A lesson is not an event of this feed
      Given a lesson published to the specialty feed of «Травматология и ортопедия»
      When the doctor opens «События»
      Then the lesson appears in no block of the events feed

    @EARS-16 @happy
    Scenario: The doctor storefront reads every doctors-audience event of any kind
      Given a published «Конгресс» event with the audience doctors linked to no project
      And a published «Встреча клуба» event with the audience doctors
      And a published «Вебинар» event with the audience doctors linked to a school project
      And a published «Эфир» event with the audience experts
      When the doctor opens «События»
      Then the three doctors-audience events are listed in the doctor's targeted feed
      And the experts-audience event is not listed
      And the selection was made by the doctor read contract on the server

    @EARS-16 @failure
    Scenario: The doctor feed never hides delivered events in the client
      When the doctor read contract answers a feed request
      Then every event in the response is rendered or excluded only by the applied facets in the URL
      And no event is delivered to the client and hidden there

    @EARS-18 @failure
    Scenario: An uncited storefront difference is a defect
      Given a build in which one storefront's events feed differs from the other outside the three cited rows
      When the cross-front reuse review runs
      Then the difference is reported as a defect

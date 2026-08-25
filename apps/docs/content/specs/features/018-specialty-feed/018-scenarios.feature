# 018 — The specialty feed — scenarios
# Tags map every scenario to the flat EARS clauses in 018-requirements-en.md.
# This is a user-facing spec: guest and doctor journeys run through Playwright BDD
# against the real apps/doctor -> NestJS -> Postgres stack. Gating, targeting and
# consent assertions that have no visual surface run in Vitest e2e.
# Stage-A picks in force: F-018-1 = Б (events first), F-018-2 = Б (typographic
# card with no cover image), F-018-3 = adjacent areas as their own block.

Feature: A doctor returns to one screen that shows what to attend, what to learn and who to grow with

  Background:
    Given feature 017's storefront shell and specialty books are in place
    And the specialty «Травматология и ортопедия» exists in specialties_minzdrav
    And the managed reference table links it to its directions and adjacent directions
    And the specialty has upcoming events, schools, courses and lessons

  @EARS-1 @happy
  Scenario: The feed renders inside 017's shell with the events block first
    Given a doctor whose remembered specialty is «Травматология и ортопедия»
    When the doctor opens the specialty feed
    Then the header, navigation and footer are rendered by feature 017's shell layout
    And the breadcrumbs and the specialty heading carrying «сменить специальность» are shown
    And the blocks appear in the order: события, школы и курсы, уроки, «Зачем это мне», смежные области, лидерборд, сообщества
    And «сменить специальность» re-opens feature 017's catalog

  @EARS-1 @happy
  Scenario: Two doctors of the same specialty see the same order
    Given two signed-in doctors who both chose «Травматология и ортопедия»
    When each of them opens the specialty feed
    Then both feeds present the blocks in the same order
    And no response field carries a ranking score, a weighting or a personalisation flag
    And no rendered string claims that the feed is built «на основе ваших данных»

  @EARS-1 @failure
  Scenario: A feed route defining its own header is a defect
    Given a build in which the feed route renders its own header element
    When the shell tree scan runs over the rendered feed
    Then the scan reports more than one header implementation
    And the build fails review

  @EARS-2 @happy
  Scenario Outline: The doctor content card renders every state from one unit
    Given the doctor content card unit exported by @ds/design-system
    When the card renders in state "<state>"
    Then it shows the kicker, the title, the metadata row and the counter
    And it exposes no cover-image slot
    And the rendered element comes from the design-system module, not from a screen-local component

    Examples:
      | state     |
      | normal    |
      | hover     |
      | focus     |
      | started   |
      | completed |
      | gate      |
      | soon      |

  @EARS-2 @failure
  Scenario: A screen-local re-implementation of the card is a defect
    Given a build in which the schools block defines its own card component
    When the tree scan for card implementations runs
    Then more than one card implementation is found
    And the build fails review

  @EARS-3 @happy
  Scenario: The statistics line is scoped to the chosen specialty
    Given two specialties with different numbers of colleagues, schools and lessons
    When a doctor opens the feed for each specialty
    Then each statistics line states the figures of that specialty
    And neither line equals the platform-wide figure
    And the read carries its computedAt

  @EARS-3 @failure
  Scenario: A counter with no source is omitted rather than zeroed
    Given the lessons counter source is unavailable for the specialty
    When a doctor opens the feed
    Then the statistics line renders the remaining counters
    And no counter is displayed as «0»

  @EARS-4 @happy
  Scenario: The nearest events stand first with the sign-up counter always visible
    When any visitor opens the feed
    Then the nearest-events block is the first block below the statistics line
    And every event card shows how many colleagues have signed up
    And «Все события по специальности →» leads into feature 019's events feed

  @EARS-4 @happy
  Scenario: An offline meet-up is a format of the event card
    Given an offline colleagues' meet-up among the nearest events
    When a visitor opens the feed
    Then the meet-up renders through the same event card with its offline format marker
    And no separate card kind is introduced for it
    And НМО appears only as an attribute of an event, never as a heading or a filter of the screen

  @EARS-5 @happy
  Scenario: A course is presented as a series and a preparing school stays visible
    Given a course of 9 episodes and a school in preparation for the specialty
    When a visitor opens the feed
    Then the course card states «9 серий»
    And the preparing school renders as «Готовится» inside the schools block
    And the schools block is not dropped from the feed

  @EARS-5 @failure
  Scenario: Academy vocabulary and commerce never reach the feed
    When a visitor opens the feed in any state
    Then the rendered page contains no occurrence of «проект»
    And it contains no Academy project card, partner news item or Academy podcast
    And it contains no price in roubles, no cart and no subscription affordance

  @EARS-6 @happy
  Scenario: The lessons block states that the app shares the same lessons and the same points account
    When a visitor opens the feed
    Then the lesson of the day renders through the doctor content card
    And «Все 47 уроков →» is present
    And a line inside the lessons block states that the same lessons are in the mobile application on one shared points account
    And that line carries no store link and no QR code
    And no separate mobile-application section exists on the page

  @EARS-7 @happy
  Scenario: «Зачем это мне» states the exchange and stops at free-for-the-doctor
    When a visitor opens the feed
    Then the value block states a new specialty, an international placement, mentorship with an expert and a document at the end of a course
    And it states «всё бесплатно для врача» with the legal partner marking

  @EARS-7 @failure
  Scenario: No rendered state ever names who pays
    When every combination of dataState, loggedIn, breakpoint and theme is rendered
    Then no rendered string states who finances the doctor's learning
    And the canvas line «обучение оплачивают партнёры платформы» appears nowhere
    And «партнёр» is used in no doctor-facing string as the carrier of money

  @EARS-8 @happy
  Scenario: Adjacent areas are their own labelled block resolved from the managed table
    When a visitor opens the feed
    Then the adjacent areas stand in their own block at the end of the feed
    And each entry names a direction read from the managed link and adjacency relation
    And following an entry opens that direction's own feed

  @EARS-8 @failure
  Scenario: Adjacency is never derived from name similarity
    Given a specialty whose name resembles another but has no adjacency row
    When the targeting set is resolved
    Then the adjacent-areas block is empty and says so
    And no item of the resembling direction appears in any block of this feed

  @EARS-9 @happy
  Scenario: The leaderboard is filtered to the specialty and contains only consented doctors
    Given doctors of the specialty, some with a recorded public-display consent and some without
    When a visitor opens the feed
    Then the leaderboard lists only the doctors who consented
    And every listed doctor belongs to the chosen specialty
    And the block states that participation is voluntary and offers «Весь лидерборд →»

  @EARS-9 @failure
  Scenario: A doctor without consent is told calmly instead of losing the block
    Given a signed-in doctor of the specialty with no public-display consent
    When the doctor opens the feed
    Then the leaderboard block is rendered
    And the doctor has no row in it
    And the block explains that there is no row because public display was not allowed and that it is changeable in the cabinet

  @EARS-10 @happy
  Scenario: Communities are listed read-only with a link out
    When a visitor opens the feed
    Then the communities block lists each community with what it is for and its doctor count
    And each entry offers «Открыть сообщество →»
    And no joining or membership control is rendered in the block

  @EARS-11 @happy
  Scenario: A guest reads the whole feed and sees honest gates
    Given a visitor with no account
    And content that requires an account among the cards
    When the visitor opens the feed
    Then every block is readable
    And the gated card renders «нужна регистрация» with its public metadata
    And following the gate leads into feature 021's registration and returns to that card

  @EARS-11 @failure
  Scenario: The gated payload never reaches an anonymous reader
    Given a visitor with no account
    When the feed block reads are served
    Then each gated item carries its public metadata and the gate marker
    And the gated payload is absent from every response body
    And no gated payload is delivered and then hidden in the client

  @EARS-12 @happy
  Scenario Outline: Each block renders exactly one honest state
    Given the block "<block>" is in data state "<dataState>"
    When a visitor opens the feed
    Then the block renders "<render>"
    And no empty labelled box and no unresolving spinner is shown

    Examples:
      | block             | dataState | render                                     |
      | Ближайшие события | загрузка  | its skeleton                               |
      | Ближайшие события | пусто     | the general platform events statement      |
      | Школы и курсы     | пусто     | «По вашей специальности пока нет школ»     |
      | Школы и курсы     | частично  | the «Готовится» card with the block intact |
      | Сообщества        | обычно    | the community list                         |

  @EARS-12 @failure
  Scenario: A failing block is contained and retries only itself
    Given the events read fails for the specialty
    When a visitor opens the feed
    Then the events block states the reason in Russian and offers «Повторить»
    And every other block renders its content
    And activating «Повторить» re-runs only the events read
    And no page-level error screen replaces the feed

  @EARS-12 @failure
  Scenario: A specialty with nothing at all never renders as a blank page
    Given a specialty with no events, schools, courses or lessons
    When a doctor opens the feed
    Then the feed states plainly that there is nothing yet for that specialty
    And it offers the adjacent areas and the general platform events

  @EARS-12 @happy
  Scenario: Started and completed content shows its own state
    Given a doctor who started one course and finished another
    When the doctor opens the feed
    Then the started card shows its progress
    And the finished card renders as completed

  @EARS-13 @happy
  Scenario: The whole feed works at the mobile breakpoint and passes axe
    When the feed is rendered below the mobile breakpoint in both themes
    Then the statistics line and all seven blocks render in the canvas mobile composition
    And every card is a real labelled link reachable by keyboard
    And the gate state is announced to a screen reader rather than conveyed by colour alone
    And the axe scan reports no violation on the feed route

  @EARS-14 @failure
  Scenario: The feed carries no Academy crossing of its own
    When a visitor opens the feed
    Then no Academy content block is rendered
    And no Academy link exists on the feed — 017's footer link remains the only crossing
    And no backstage navigation entry is present

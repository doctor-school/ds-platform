# 020 — The event page for both storefronts — scenarios
# Tags map every scenario to the flat EARS clauses in 020-requirements-en.md.
# This is a user-facing spec: guest and doctor journeys run through Playwright BDD
# against the real apps/doctor -> NestJS -> Postgres stack, with the Academy route
# covered by its own cross-host scenarios against apps/portal. Lifecycle, room
# state, registrations and recordings come from features 004 / 005 / 006 / 014,
# never from a seeded stand-in.
# Stage-A picks in force: F-020-1 = А (one right column, the sticky sign-up card
# only, «Ведёт» in the left flow), F-020-2 = Б (hybrid as two tabs «очно / онлайн»),
# F-020-3 = Б (offline seats gone: hybrid switches to online, pure offline states
# «мест нет»), F-020-4 = А (the mini-survey follows the rating — wave-2 shape only).
# Scenarios tagged @deferred assert an ABSENCE: the release-3 proof of a wave-2
# clause is that nothing at all is rendered in its place (LD-8), never a stub.

Feature: One event page serves the doctor storefront and the Academy, and a doctor decides in seconds

  Background:
    Given feature 017's doctor storefront shell is in place
    And feature 004's public event read, EventLifecycleState machine and one-CTA contract are in place
    And features 005 / 021 own registration and its consents, feature 006 owns the room and feature 014 owns recordings
    And the event «Ведение пациентов с остеоартритом» is published with a description, a programme, a teaser, three specialty chips, an НМО badge and two speakers
    And the event is readable at the same stable slug on doctor.school and on academy.doctor.school

  # --- Happy path: the whole doctor funnel on one host ---

  @EARS-5 @EARS-1 @EARS-2 @EARS-6 @EARS-7 @happy
  Scenario: A guest reads the whole event, participates, returns to the same page and enters the room on the doctor host
    Given a guest with no account opens «#d-event» on doctor.school at "/events/vedenie-osteoartrit?mode=online"
    Then the page renders server-side with no authentication required
    And the open part shows the title, the school kicker, the start date and time labelled «МСК», the duration, «О чём событие», the programme, the teaser, the specialty chips, the НМО badge and both speakers
    And each speaker name links to their expert page and the school kicker links to the school page
    And the right column holds the sticky sign-up card and no other card
    And the sticky card shows the conditions line and exactly one primary CTA «Участвовать»
    When the guest activates «Участвовать»
    Then the guest enters feature 021's registration on doctor.school
    And the registration carries the event and the return URL "/events/vedenie-osteoartrit?mode=online"
    When the guest completes feature 021's registration
    Then the doctor lands back on "/events/vedenie-osteoartrit?mode=online" with the participation intent resumed
    And the sticky card reads «Вы записаны» with an add-to-calendar affordance, a cancel-sign-up affordance and a link into «Мои события»
    And no «Участвовать» CTA is rendered anywhere on the page
    When feature 006 opens the room for the event
    Then the sticky card offers room entry with the presence count of colleagues already there
    And the room entry href is a route of doctor.school over the shared room UI unit
    And no academy.doctor.school URL is present anywhere in the rendered page

  # --- Failure branches ---

  @EARS-10 @failure
  Scenario: A draft event is not found on either storefront
    Given the event «Закрытый разбор клинических случаев» is in the draft lifecycle state
    When any visitor requests that event by its slug on doctor.school
    Then the response is not-found and is indistinguishable from a non-existent event
    When any visitor requests that same event by its slug on academy.doctor.school
    Then the response is not-found and is indistinguishable from a non-existent event
    And no title, description, programme, speaker or date of the draft event appears in either response body

  @EARS-9 @failure
  Scenario: A pure offline event with no seats left states «мест нет» and offers no control
    Given the offline event «Мастер-класс по артроскопии» has seatsTotal 40 and seatsLeft 0
    When a signed-in doctor without a registration opens the event page
    Then the participation policy resolves to "sold-out"
    And the format block states «мест нет» in plain words
    And no participation CTA exists anywhere in the DOM — not enabled, not disabled and not visually hidden
    And no waiting-list affordance is offered and no waiting-list field exists in the response body
    And the doctor never discovers that seats are gone only after registering

  @EARS-7 @failure
  Scenario Outline: An unregistered reader on a live event gets the participation path and never a room URL
    Given feature 006 reports an open room for the event
    And the reader is "<reader>" and holds no registration on the event
    When the reader opens the event page on doctor.school
    Then the sticky card offers the participation path, not room entry
    And the participation policy resolves to "register"
    And no room URL is present in the response body or in the rendered DOM
    When the reader requests the room route directly
    Then the room refuses entry and the reader is returned to the participation path

    Examples:
      | reader                     |
      | an anonymous visitor       |
      | a signed-in doctor         |

  @EARS-9 @failure
  Scenario: A hybrid event whose offline seats are gone moves the doctor to online participation
    Given the hybrid event «Конгресс по травматологии» has seatsLeft 0 on its offline part
    When a signed-in doctor without a registration opens the event page with no mode in the URL
    Then the participation policy resolves to "switch-to-online"
    And the format block opens on the «онлайн» tab without a client-side redirect
    And the format block says in plain words that offline seats are gone and participation continues online
    And exactly one participation CTA is rendered
    And no waiting list is offered on either tab

  @EARS-19 @failure
  Scenario: A rendered block with neither content, a skeleton, an honest statement nor an error fails review
    Given a build in which the programme block renders an empty labelled box when the programme is unpublished
    When the page-state scan runs over every state of both routes
    Then the scan reports a block that is neither content, a skeleton, an honest statement nor an error with a working retry
    And the build fails review

  # --- Cross-host identity and one account ---

  @EARS-1 @EARS-18 @happy
  Scenario: The two storefronts render the same event from one core under their own headers
    When an anonymous reader requests the event on doctor.school
    And an anonymous reader requests the same event on academy.doctor.school
    Then the two public bodies are content-identical
    And the two renders differ only in the storefront header, the route envelope and copy defaults
    And a component-tree scan finds no second page composition, read model or CTA resolver in either application
    And no import from apps/portal exists in apps/doctor and none from apps/doctor in apps/portal

  @EARS-18 @happy
  Scenario: A doctor signed in on the doctor storefront opens the Academy page already signed in
    Given a doctor signed in on doctor.school
    When the doctor opens the same event on academy.doctor.school
    Then the doctor is already signed in through the one-account silent re-auth
    And the doctor is never asked for a second sign-in
    When the doctor starts a registration from academy.doctor.school
    Then the return after registration lands on the academy.doctor.school page it started on
    And no link, string or navigation element on «#d-event» leads into the Academy backstage

  # --- Layout, format, proof, gate, purity, a11y ---

  @EARS-4 @happy
  Scenario: The page lays out to F-020-1 А with exactly one CTA
    When a doctor opens the event page at 1440
    Then the right column contains exactly one card and it is the sticky sign-up card
    And the «Ведёт» speaker card is in the left flow and scrolls away with the content
    And the conditions line above the CTA reads the format, the start time labelled «МСК», the duration, the НМО value and the cost in Pul
    And exactly one primary CTA exists in the DOM
    And no «купить», «оставить заявку» or «скачать» affordance exists in any state

  @EARS-8 @happy
  Scenario: The hybrid tab is URL state that survives sharing, reload and the back button
    Given the hybrid event «Конгресс по травматологии» has offline seats available
    When a doctor opens the event page and switches to the «очно» tab
    Then the URL carries "mode=offline"
    And the offline sub-block shows the address, the map and «как добраться»
    When the doctor reloads the page
    Then the «очно» tab is still selected
    When the doctor presses the browser back button
    Then the «онлайн» tab is selected and the page has not been left
    And the same link opened by another doctor reproduces the same tab

  @EARS-8 @happy
  Scenario Outline: Only the format block differs between formats
    Given an event of format "<format>"
    When a doctor opens the event page
    Then everything outside the format block renders identically to the other formats
    And the format block carries "<carries>"

    Examples:
      | format  | carries                                                      |
      | online  | the room block and when the room opens relative to the start |
      | offline | the address, the map, «как добраться» and the seat count     |
      | hybrid  | two tabs «очно / онлайн» switchable at any time              |

  @EARS-3 @happy
  Scenario: The sign-up proof is the same for a guest and a signed-in doctor and absent when there are none
    Given 37 doctors of the event's specialty and 14 of adjacent specialties are registered
    When a guest opens the event page
    Then the sticky card states the count of registered colleagues and, separately, the count from adjacent specialties
    And the same counts render for a signed-in doctor
    And the counts come from the same registration count feature 019's card renders
    Given a second event with no sign-ups at all
    When a doctor opens that event page
    Then no sign-up count is rendered and no zero-shaped placeholder appears

  @EARS-10 @happy
  Scenario Outline: Every lifecycle state renders from the one machine on both hosts
    Given the event is in the "<state>" lifecycle state
    When a doctor opens the event page on either storefront
    Then the page renders "<render>"
    And no dead or disabled CTA is rendered

    Examples:
      | state             | render                                                                       |
      | upcoming          | the participation CTA                                                        |
      | live              | the live signal and room entry for a registered doctor                       |
      | ended             | no participation CTA, plus the recording and materials feature 014 published |
      | archived          | feature 004's public «мероприятие в архиве» notice, not a 404 or a redirect  |
      | cancelled-or-moved| a plain statement that the event is cancelled or moved and a new date will be announced |

  @EARS-10 @happy
  Scenario: The cancelled state carries no points statement in release 3
    Given the event is in the cancelled-or-moved lifecycle state
    When a doctor who paid Pul for a comparable event opens the page
    Then the page states that the event is cancelled or moved
    And no statement about the doctor's points, refund or balance is rendered
    And no such statement is derived from configuration

  @EARS-11 @happy
  Scenario: The medical-status gate closes only the gated material and explains itself
    Given the event carries material that requires a confirmed medical-professional status
    When an unverified doctor opens the event page
    Then the rest of the page stays fully readable
    And the closed part explains the reason in words rather than by an unlabelled lock
    And the verification-status line offers a working route to confirm the status against feature 009
    And the gated material is absent from the response body rather than delivered and hidden in the client
    And the closed part renders neither a blank area nor a «скоро» marker

  @EARS-19 @happy
  Scenario: The page is pure — no financing statement, no commerce, no НМО headline
    When a full-text scan runs over every state, breakpoint, theme and host of the event page
    Then no rendered string or response field states who finances the event
    And no price in roubles, cart, subscription or payment affordance appears
    And «партнёр» is never used as the money-carrier and «проект» appears in no doctor-facing string
    And НМО appears only as a badge and as a conditions-line value, never as a heading
    And a zero cost reads «бесплатно для врача»
    And every date and time renders in Europe/Moscow labelled «МСК»
    And no user-facing string is hardcoded outside the typed message catalog

  @EARS-20 @happy
  Scenario Outline: Both routes are accessible at both breakpoints in both themes
    When the event page is rendered on "<host>" at "<width>" in the "<theme>" theme
    Then the axe scan reports no violations
    And the single CTA is a real labelled control with visible focus
    And the F-020-2 Б tabs are keyboard-operable and their selection is announced
    And the live signal is announced to a screen reader rather than conveyed by colour alone
    And at 390 the sticky sign-up card reflows without trapping focus and without hiding the CTA

    Examples:
      | host                  | width | theme |
      | doctor.school         | 1440  | light |
      | doctor.school         | 390   | dark  |
      | academy.doctor.school | 1440  | dark  |
      | academy.doctor.school | 390   | light |

  # --- Release-3 absence proofs for the wave-2 clauses (LD-8) ---

  @EARS-12 @deferred @failure
  Scenario: No points economy beyond the cost parameter ships in release 3
    When a full-text scan runs over every state of the event page
    Then the Pul cost of the event renders as a conditions-line value
    And no balance, no shortfall message, no advance and no accrual is rendered
    And no placeholder, disabled control or «скоро» marker stands in for any of them

  @EARS-13 @deferred @failure
  Scenario: No live-эфир interaction ships in release 3
    Given feature 006 reports an open room for the event
    When a registered doctor opens the event page
    Then no question box, poll, vote control, advertising marking field or inline reminder is rendered
    And no placeholder for any of them is rendered

  @EARS-14 @deferred @failure
  Scenario: No НМО check-in surface ships in release 3
    When a doctor opens the event page in any lifecycle state
    Then no check-in control and no credit-outcome statement is rendered
    And НМО appears only as a badge and a conditions-line value

  @EARS-15 @deferred @failure
  Scenario: No ticket, QR or door scan ships in release 3
    Given a registered doctor holds a registration on an offline event and on a hybrid event
    When the doctor opens either event page
    Then the offline block carries the address, the map, «как добраться» and the seats
    And no ticket, QR code or door-scan affordance is rendered on either page

  @EARS-16 @deferred @failure
  Scenario: No feedback block ships in release 3
    Given the event is in the ended lifecycle state and feature 014 has published the recording
    When a doctor who attended opens the event page
    Then the recording and the materials are rendered
    And no rating control, review form or partner mini-survey is rendered

  @EARS-17 @deferred @failure
  Scenario: No partner attribution element ships in release 3
    Given the event carries a free-text partner reference in its record
    When a doctor opens the event page on either storefront
    Then no partner attribution element is rendered
    And no marking field appears in the response body
    And the free-text partner reference is not rendered anywhere

  @EARS-6 @deferred @failure
  Scenario: No pre-start reminder is promised in release 3
    Given a signed-in doctor holds a registration on an upcoming event
    When the doctor opens the event page
    Then the sticky card offers the calendar add, the cancel affordance and the «Мои события» link
    And no reminder promise, reminder setting or reminder placeholder is rendered

  # --- Process gate ---

  @EARS-21 @happy
  Scenario: The ownership matrix and the canvas gate precede implementation
    Given an implementation Issue for any 020 surface is about to start
    Then the cross-front ownership and extraction matrix in 020-design.md is verified against repository reality and updated
    And the build-ui-from-design-system gate is run against the vendored canvas «webinar-page-variant-a.dc.html» and the reused canvas files
    And every canvas state is covered at 1440 and 390, in both themes, on both hosts
    And the recorded Stage-A picks F-020-1 А, F-020-2 Б, F-020-3 Б and F-020-4 А are treated as decisions rather than re-opened questions
    And the canvas «board» fork stand is not built
    And the rendered result is re-confirmed with the product owner on the live stand before merge

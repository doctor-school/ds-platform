# 013 — Academy home page and partner lead capture — scenarios
# Tags map every scenario to the flat EARS clauses in 013-requirements-en.md.
# This is a user-facing spec: guest-doctor and partner journeys run through
# Playwright BDD against the real portal -> NestJS -> Postgres stack; API/DB-only
# assertions run in Vitest e2e. @independent and @012-dependent mark the delivery
# wave of each scenario.

Feature: The academy's front door serves a doctor and a partner on one public page

  Background:
    Given the landing at / is public and requires no session
    And the approved canvas «Главная» variant «в» (split hero) is the composition source of truth
    And the эфиры feed renders through feature 014's shared event list unit
    And every string of the page resolves from the page content module
    And a figure is rendered only when it is a real platform count
    And no control on the page points at a route that does not exist

  # ---------------------------------------------------------------- the page itself

  @EARS-1 @independent @happy
  Scenario: A guest opens the academy front door
    Given a visitor with no account and no session
    When the visitor opens /
    Then the landing renders with no redirect and no authentication prompt
    And the sections appear in the canvas order for variant «в»
    And the closing screen carries exactly one lead form

  @EARS-1 @independent @happy
  Scenario: An authenticated visitor is not intercepted by the landing
    Given a doctor with a valid session
    When the doctor opens / directly
    Then the same landing renders
    And the doctor is not redirected, gated or shown a different page

  @EARS-2 @independent @happy
  Scenario Outline: Both audiences are addressed in the first screen
    Given the landing is open at the <breakpoint> breakpoint
    Then the doctor column and the partner column are both present in the hero
    And neither column is collapsed, tabbed away or moved below the fold
    When the visitor activates the <action> action with the keyboard
    Then the visitor reaches <destination>
    And the control shows the canvas focus treatment

    Examples:
      | breakpoint | action           | destination                  |
      | desktop    | doctor           | the /webinars listing        |
      | desktop    | partner          | the lead form at #partner-form |
      | mobile     | doctor           | the /webinars listing        |
      | mobile     | partner          | the lead form at #partner-form |

  # ---------------------------------------------------------------- эфиры feed

  @EARS-3 @independent @happy
  Scenario: The feed shows real эфиры and opens them
    Given four or more publishable events exist
    When a visitor opens /
    Then the feed is the first section under the hero
    And it lists the latest three events from the same public listing /webinars uses
    And the list is rendered by feature 014's shared event list unit
    When the visitor opens the first card
    Then the visitor lands on that event's page at /webinars/[slug]

  @EARS-3 @independent @failure
  Scenario: The home page does not fork the list unit
    When the landing's feed is inspected in the codebase
    Then it renders the shared unit with items only, and no tab bar or pager
    And no home-local card, list or pager implementation exists
    And no home-only listing endpoint or second ordering rule exists

  @EARS-4 @independent @failure
  Scenario: An empty feed states the truth
    Given no publishable event exists
    When a visitor opens /
    Then the feed section states in Russian that there is nothing scheduled yet
    And the «Все эфиры →» route to /webinars is still present
    And no empty labelled shell, persistent skeleton or fabricated card is rendered

  @EARS-4 @independent @failure
  Scenario: A failing listing read degrades the section, not the page
    Given the public event listing read fails
    When a visitor opens /
    Then the feed section renders its honest state
    And every other screen of the landing renders normally
    And the page returns a successful response

  # ---------------------------------------------------------------- curated screens

  @EARS-5 @EARS-6 @independent @happy
  Scenario: The argument screens render from the canvas and the content module
    When a visitor opens /
    Then the «Что такое Doctor.School» screen renders its four pillar cards
    And the «Зачем» screen renders the dashed «Сейчас» column beside the solid «Мы создаём» column
    And every card and row text comes from the content module
    And no card or row renders empty

  @EARS-7 @independent @happy
  Scenario: The ecosystem screen carries projects as content while 015 is unshipped
    When a visitor opens /
    Then the ecosystem screen renders its curated tiles at anchor #projects
    And a tile counter is shown only when it is a real platform count
    And no «Все проекты →» control is rendered at all

  @EARS-7 @independent @failure
  Scenario: A missing section route is never faked
    When every control of the landing is enumerated
    Then none of them resolves to /projects or /experts
    And none of them is a disabled control, a «#» link or a placeholder page

  @EARS-8 @012-dependent @happy
  Scenario: The people screen shows real published experts
    Given feature 012's public expert read is available with five published experts
    And one further expert is draft and one is retired
    When a visitor opens /
    Then the people screen renders four expert cards at anchor #people
    And each card shows the expert's name, professional role, credentials and affiliation
    And no card shows an event count
    And neither the draft nor the retired expert appears
    And the page issued one bounded expert read with no per-card relationship call

  @EARS-8 @012-dependent @failure
  Scenario Outline: Without expert data the grid is absent, never stubbed
    Given <situation>
    When a visitor opens /
    Then no expert grid is rendered
    And no seeded, example or placeholder expert card appears
    And the people screen's heading, narrative and podcast block render normally

    Examples:
      | situation                                     |
      | the 012 expert wave has not landed            |
      | the 012 read returns no published expert      |

  @EARS-9 @independent @happy
  Scenario: The podcast block is content, and its control is honest
    When a visitor opens /
    Then the podcast block renders its episode rows from the content module
    And the «Все выпуски» control is rendered only when a real destination is configured
    And no row or control links to «#»
    And no podcast entity, table or admin surface exists in the codebase

  @EARS-10 @independent @happy
  Scenario: Every partner path leads to the one form
    When a visitor opens /
    Then the partner value band renders its benefit cards at anchor #partners
    And the participation-formats screen renders its format cards
    When the visitor activates any format card or the band's own action
    Then the visitor reaches the single lead form at #partner-form
    And no second form, second route or mailto substitute is offered in its place

  # ---------------------------------------------------------------- lead capture

  @EARS-11 @independent @happy
  Scenario: The form asks for exactly the approved fields
    When a visitor reaches the lead form
    Then a required name field is present
    And an optional company-or-clinic field is present
    And one required combined «Email или Telegram» field with the placeholder «name@company.ru или @username» is present
    And the role select offers «Эксперт», «Партнёр», «Участник подкаста», «Соавтор направления», «Компания» in that order
    And a required consent checkbox names 152-ФЗ and links the published privacy policy
    And no free-text message field is present

  @EARS-12 @independent @failure
  Scenario Outline: Invalid input is refused with an actionable message and nothing is lost
    Given a visitor has filled the lead form with <defect>
    When the visitor submits
    Then the offending field is marked with a Russian message stating what to fix
    And the accessible error summary is rendered and receives focus
    And every other entered value is preserved
    And no lead is persisted and no notification is sent

    Examples:
      | defect                            |
      | an empty name                     |
      | an empty contact                  |
      | a contact that is neither an email nor a Telegram handle |
      | the consent checkbox unchecked    |

  @EARS-12 @independent @failure
  Scenario: A request that bypasses the browser is rejected identically
    When a lead request with an unchecked consent flag is posted directly to the API
    Then the API rejects it with an RFC 7807 Problem Details document and an exact errorCode
    And no lead row is created

  @EARS-13 @independent @happy
  Scenario: An accepted lead is persisted once with its consent evidence
    Given a visitor has filled the lead form correctly
    When the visitor submits
    Then exactly one retained leads row exists
    And it carries the consent purpose, version tag, exact accepted text, its SHA-256 digest, the acceptance instant and the policy URL
    And the stored digest matches the stored text
    When the same submission is replayed with the same Idempotency-Key
    Then still exactly one leads row exists

  @EARS-13 @independent @failure
  Scenario: Personal data never leaves through a log or a trace
    Given a visitor has submitted a lead
    When the application logs, error payloads and traces of that request are inspected
    Then none of them contains the submitted name, contact or company value

  @EARS-14 @independent @happy
  Scenario: The commercial team is notified and the visitor is told
    Given the dedicated «DS Лиды» webhook is configured
    When a visitor submits a valid lead
    Then the form is replaced by the confirmation state stating the request was received
    And an affordance to send another request is offered
    And the lead is posted to the channel through ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL
    And no post is made to the deploy/CI MATTERMOST_WEBHOOK_URL

  @EARS-14 @independent @failure
  Scenario Outline: A notification failure never costs a lead
    Given <condition>
    When a visitor submits a valid lead
    Then the lead row is persisted
    And the visitor still sees the confirmation state
    And an operational error is raised carrying the lead id and no personal data

    Examples:
      | condition                                  |
      | the Mattermost webhook returns an error    |
      | the Mattermost webhook is unreachable      |
      | the lead webhook variable is unset         |

  @EARS-14 @independent @happy
  Scenario: A second request from the same visitor is accepted
    Given a visitor has already submitted a lead in this session
    When the visitor uses the re-submit affordance and submits again within the rate limit
    Then a second retained lead row exists
    And the confirmation state is shown again

  @EARS-18 @independent @failure
  Scenario: Flooding the public endpoint is refused politely
    Given a client has exceeded the lead endpoint's rate limit
    When the client submits again
    Then the API refuses with an RFC 7807 Problem Details document and an exact errorCode
    And the form preserves every entered value and states the refusal in plain Russian
    And a retry is offered

  @EARS-18 @independent @failure
  Scenario: The lead resource exposes no read surface
    When the lead resource's routes are enumerated
    Then only the public submission route exists
    And no read, list, admin or export route for leads exists

  # ---------------------------------------------------------------- post-login landing

  @EARS-15 @independent @happy
  Scenario: A doctor returns to the page they were consuming
    Given a guest tried to consume a login-gated page
    When the guest completes login
    Then the doctor lands back on that exact page
    And the doctor does not land on the marketing landing

  @EARS-15 @independent @happy
  Scenario Outline: With no return target the default is /webinars
    Given a visitor starts <flow> with no captured return target
    When the flow completes
    Then the visitor lands on /webinars
    And the visitor never lands on /

    Examples:
      | flow          |
      | login         |
      | registration  |
      | verification  |

  @EARS-15 @independent @failure
  Scenario: The landing default is re-pointed in code and in the spec
    When the portal's landing default is inspected
    Then the default landing constant resolves to /webinars
    And the two tests that pin it assert /webinars
    And feature 008's requirements and design carry the amendment naming 013 EARS-15 as its source

  # ---------------------------------------------------------------- shell, mobile, copy

  @EARS-16 @independent @happy
  Scenario: The landing lives inside the app shell
    When a visitor opens /
    Then the feature 008 header, mobile menu and footer are rendered
    And the header carries the эфиры entry, the theme control and the authentication affordance
    And the header carries no entry for /projects or /experts
    And the landing adds only its own footer partnership anchor and the canvas watermark

  @EARS-17 @independent @happy
  Scenario Outline: The whole page works on a phone and passes the accessibility bar
    Given the landing is rendered at the <breakpoint> breakpoint in the <theme> theme
    Then every screen, the feed, the expert grid and the form render in the canvas composition
    And every action is a real labelled interactive element
    And every field is labelled and associated with its error
    And axe reports no serious or critical violations

    Examples:
      | breakpoint | theme |
      | desktop    | light |
      | desktop    | dark  |
      | mobile     | light |
      | mobile     | dark  |

  @EARS-20 @independent @happy
  Scenario: Copy is content, not structure
    Given every string of the page resolves from the content module
    When every string is replaced with the owner's edited copy
    Then no component, layout or test selector changes
    And the page renders the new copy in the same composition

  @EARS-20 @independent @failure
  Scenario: The stub's copy is never inherited
    When the landing's rendered strings are compared with the interim stub's copy
    Then no string is imported from the stub view
    And no rendered figure is a placeholder number from the canvas

  @EARS-19 @independent @happy
  Scenario: The design gate runs before and after the build
    Given the landing is a user-facing surface
    Then the build ran the design-system-first gate against the vendored canvases before implementation
    And the rendered page was confirmed by the product owner on the live stand before merge
    And the recorded canvas defaults were treated as decisions rather than re-opened questions

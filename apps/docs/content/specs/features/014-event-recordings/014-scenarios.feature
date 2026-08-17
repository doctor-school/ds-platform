# 014 — Event recordings and the archived-event page — scenarios
# Tags map every scenario to the flat EARS clauses in 014-requirements-en.md.
# This is a user-facing spec: doctor and guest journeys run through Playwright BDD
# against the real portal -> NestJS -> Postgres stack. API/DB-only assertions run
# in Vitest e2e. @core and @facets mark the delivery wave of each scenario.

Feature: A finished broadcast keeps its value as a recording, and the archive is browsable

  Background:
    Given every recording mutation carries a canonical Idempotency-Key and the target ETag
    And event_recordings rows are retained with restrictive foreign keys and no Delete route
    And the display rule is derived at read time from published non-retired recordings only
    And Stage A is recorded in 014-product.md and the vendored canvases are the composition source of truth

  # ---------------------------------------------------------------- operator

  @EARS-1 @core @happy
  Scenario Outline: An operator attaches a recording of an explicit kind
    Given a finished event with no recording of kind <kind>
    When the operator attaches a <kind> recording with a playable source
    Then one retained event_recordings row exists with that kind, version 1 and status draft
    And the public event page still shows the «запись готовится» plaque
    And no URL column was written on the event row

    Examples:
      | kind   |
      | raw    |
      | edited |

  @EARS-1 @core @failure
  Scenario: A second recording of the same kind is refused, not silently accepted
    Given a finished event with a published raw recording
    When the operator attaches another raw recording
    Then the request fails with 409 RECORDING_KIND_OCCUPIED naming the existing row
    And no second raw row is created

  @EARS-1 @EARS-2 @core @happy
  Scenario: Retiring a recording frees its kind slot without losing history
    Given a finished event with a draft raw recording
    When the operator retires that recording
    And attaches a new raw recording
    Then the retired row is still addressable with deleted_at set
    And the new raw row is created in draft

  @EARS-2 @core @happy
  Scenario: Publication is a separate act from attachment
    Given a finished event with a draft edited recording
    When the operator publishes it
    Then first_published_at is set once on that row
    And the event's own lifecycle state is unchanged
    When the operator unpublishes it and publishes it again
    Then first_published_at still holds its original value

  @EARS-2 @core @failure
  Scenario: A recording cannot be published for an unfinished event
    Given a published event whose broadcast has not ended
    And a draft edited recording attached to it
    When the operator publishes that recording
    Then the request fails with 409 EVENT_NOT_FINISHED
    And the recording is still draft

  @EARS-2 @core @failure
  Scenario: The panel offers no Delete anywhere
    Given a finished event with a published edited recording
    When the operator inspects every action in the recordings panel
    Then no Delete control is present
    And no HTTP Delete route exists for a recording

  # ---------------------------------------------------------------- display rule

  @EARS-3 @core @happy
  Scenario Outline: The display rule is derived from the published rows alone
    Given a finished event whose published recordings are <published>
    When any surface reads its recording state
    Then the derived state is <state>
    And the main player carries <primary>
    And the secondary slot carries <secondary>

    Examples:
      | published    | state     | primary | secondary |
      | edited + raw | montage   | edited  | raw       |
      | edited only  | montage   | edited  | nothing   |
      | raw only     | raw-only  | raw     | nothing   |
      | none         | preparing | nothing | nothing   |

  @EARS-3 @EARS-8 @core @happy
  Scenario: Publishing the edited cut later promotes it with no page edit
    Given a finished event with only a published raw recording
    And a doctor is signed in and viewing that event page
    When the operator publishes an edited recording for the same event
    And the doctor reloads the page
    Then the main player carries the edited recording
    And the raw capture is reachable through the «Смотреть оригинал трансляции» spoiler
    And no operator edited the page itself

  @EARS-8 @core @happy
  Scenario: The secondary affordance is absent when only one kind is published
    Given a finished event with only a published edited recording
    When a signed-in doctor opens the event page
    Then no secondary recording control is rendered

  # ---------------------------------------------------------------- public read + gate

  @EARS-4 @core @happy
  Scenario: A guest reads the whole archived page on the single event route
    Given a finished event with a published edited recording
    When a visitor with no account opens /webinars/<slug>
    Then the announcement, description, speakers, projects, topics and materials all render
    And the page is the same /webinars/<slug> route as before the broadcast
    And no archive-only mirror route exists

  @EARS-5 @core @failure
  Scenario: No playable source reaches an unauthenticated caller
    Given a finished event with a published edited recording
    When the public event endpoint is read with no session
    Then the response body carries the recording state, kind and poster
    And the response body contains no playable source reference anywhere
    And the playback endpoint read with no session fails with 401 AUTHENTICATION_REQUIRED

  @EARS-5 @core @happy
  Scenario: The guest gate is an honest invitation, not a paywall
    Given a finished event with a published edited recording
    When a visitor with no account reaches the player position
    Then a dimmed poster and a boxed invitation are rendered
    And the invitation states that viewing requires a free account
    And it offers a real labelled sign-in action

  @EARS-5 @core @happy
  Scenario: Any account may watch any published recording
    Given a finished event with a published edited recording
    And a signed-in doctor who never registered for that event
    When the doctor opens the event page
    Then the playback endpoint returns the edited source
    And no registration, role or attendance check was applied

  # ---------------------------------------------------------------- return to origin

  @EARS-6 @core @happy
  Scenario: Signing in from the gate returns the visitor to the same recording
    Given a visitor with no account on the page of a finished event with a published recording
    When the visitor follows the sign-in invitation and completes registration and verification
    Then the first authenticated navigation lands back on that same event page
    And the player renders

  @EARS-6 @core @failure
  Scenario Outline: A hostile return target is dropped rather than followed
    Given a login flow entered with the return target <target>
    When the visitor authenticates
    Then the visitor lands on the surface's default landing
    And no redirect to <target> is issued

    Examples:
      | target                      |
      | https://example.invalid/    |
      | //example.invalid/          |
      | \\example.invalid\          |

  # ---------------------------------------------------------------- preparing plaque

  @EARS-7 @core @happy
  Scenario: The plaque states the readiness date the operator set
    Given a finished event with no published recording
    And the operator set a readiness date on that event
    When any visitor opens the event page
    Then the «запись готовится» plaque renders in the player's position with that date
    And no empty or broken player is rendered

  @EARS-7 @core @happy
  Scenario: The plaque is honest without a date too
    Given a finished event with no published recording and no readiness date
    When any visitor opens the event page
    Then the plaque renders an honest line with no fabricated timeframe

  @EARS-7 @core @happy
  Scenario: The plaque clears and returns by itself
    Given a finished event showing the plaque
    When the operator publishes a raw recording
    Then the plaque is gone and the player renders for a signed-in doctor
    When the operator retires that recording
    Then the plaque renders again with its readiness date
    And the operator edited no page in either direction

  @EARS-7 @core @failure
  Scenario: An unavailable source fails honestly
    Given a finished event with a published edited recording whose provider is unreachable
    When a signed-in doctor opens the event page
    Then the playback read fails with 503 RECORDING_SOURCE_UNAVAILABLE
    And the page renders an explicit unavailability message with a retry affordance
    And no silently dead player is rendered

  # ---------------------------------------------------------------- my events

  @EARS-9 @core @happy
  Scenario: «Мои события» renders exactly the two canvas tabs
    Given a doctor with registrations for both upcoming and past events
    When the doctor opens «Мои события»
    Then exactly two tabs are rendered, «Предстоящие» and «Записи»
    And «Предстоящие» is selected by default
    And no «Сертификаты» tab, placeholder or disabled stub is present

  @EARS-9 @core @happy
  Scenario: Each tab shows the full history newest first
    Given a doctor with registrations spanning more than a year
    When the doctor opens either tab of «Мои события»
    Then every registration on that side of today is listed
    And the entries are ordered newest first
    And the list is rendered by the shared event list unit

  @EARS-9 @core @happy
  Scenario: A past registered event with no recording is still listed
    Given a doctor registered for a past event that has no published recording
    When the doctor opens the «Записи» tab
    Then that event is listed with the preparing badge
    And its link opens the event page showing the plaque

  # ---------------------------------------------------------------- shared unit

  @EARS-10 @core @happy
  Scenario: The list unit is controlled and fetch-free
    Given the shared event card, list and pagination unit
    When it is rendered with injected items, tab, counts and cursor
    Then it issues no data request of its own
    And it reports tab and page changes through its callbacks

  @EARS-10 @core @failure
  Scenario: A surface-local list implementation is refused
    Given the /webinars listing, the project page, the expert page and «Мои события»
    When their card, list and pagination code is inspected
    Then all four render the same shared unit
    And no surface carries its own card, list or pager implementation

  # ---------------------------------------------------------------- webinars tabs

  @EARS-11 @core @happy
  Scenario: /webinars gains a past tab with counts
    Given a mix of upcoming and finished events
    When any visitor opens /webinars
    Then «Предстоящие · N» and «Прошедшие · N» tabs render with correct counts
    And the past tab lists finished events newest first with their recording-state badge
    And the listing is reachable with no account

  @EARS-11 @core @happy
  Scenario: Upcoming discovery is refined, not redesigned
    Given the existing /webinars listing behaviour before 014
    When the past tab ships
    Then the «Неделя | Месяц» views behave exactly as before
    And the upcoming listing composition is unchanged

  @EARS-11 @EARS-15 @core @happy
  Scenario: Browsing the archive and the gate are one continuous path
    Given a visitor with no account on the «Прошедшие» tab
    When the visitor opens an entry
    Then the post-live page renders fully readable
    And the sign-in invitation is the next step in the player position

  # ---------------------------------------------------------------- facets

  @EARS-12 @facets @happy
  Scenario: The three facets render as the canvas draws them
    Given the event listing with the facet unit
    When a visitor opens the Проект facet
    Then a searchable dropdown lists options with per-option counts
    And selecting one adds an active-filter badge with its own clear control
    And a «Сбросить всё» control clears every facet

  @EARS-12 @facets @happy
  Scenario: A zero-yield option stays visible and selectable
    Given a facet option that yields no events under the current selection
    When the visitor opens that facet
    Then the option is listed with no count
    And it is selectable rather than disabled or hidden

  @EARS-13 @facets @happy
  Scenario: Facets compose with AND
    Given events tagged with several projects, experts and topics
    When the visitor selects one project, one expert and one topic
    Then only events matching all three are listed
    And the page is served by one bounded paginated query plus one facet-option query

  @EARS-13 @facets @happy
  Scenario: Counts reflect the other facets, not the facet's own selection
    Given a project facet selection is active
    When the visitor reopens the project facet
    Then its option list still shows every eligible project
    And the expert and topic counts reflect the active project selection

  @EARS-13 @facets @failure
  Scenario: An empty combination is a successful empty page
    Given a facet combination that matches no event
    When the listing is read
    Then the response is 200 with empty data and terminal pagination
    And no error is rendered

  @EARS-13 @facets @failure
  Scenario Outline: An ineligible facet id is indistinguishable from an unknown one
    Given a taxonomy record that is <state>
    When the listing is filtered by its id
    Then the response is 404 RESOURCE_NOT_FOUND
    And the response reveals nothing about that record

    Examples:
      | state       |
      | draft       |
      | retired     |
      | nonexistent |

  @EARS-14 @facets @happy
  Scenario: The filter capability lands inside the shared unit
    Given the facet capability has shipped
    When the project page, the expert page and «Мои события» are inspected
    Then each gains the same filtering by consuming the shared unit
    And no forked copy of the unit and no second filtering contract exists

  # ---------------------------------------------------------------- mobile, a11y, gates

  @EARS-15 @core @happy
  Scenario Outline: Every 014 surface works at both breakpoints
    Given the surface <surface>
    When it is rendered at the mobile and the desktop breakpoint in both themes
    Then it matches the canvas composition for that breakpoint
    And it passes the playwright-axe gate
    And its controls are keyboard reachable and labelled

    Examples:
      | surface                     |
      | archived event page         |
      | guest gate                  |
      | «запись готовится» plaque   |
      | secondary recording spoiler |
      | /webinars tabs and pager    |
      | facet unit                  |
      | «Мои события» tabs          |

  @EARS-16 @core @happy
  Scenario: Canvas defaults are treated as decisions
    Given the vendored canvases webinar-archive, events-filter and my-events
    When a 014 surface is designed
    Then secondaryUi is spoiler
    And «Мои события» has two tabs
    And the /webinars past control is tabs mirroring the project and expert pages
    And none of these is re-opened as a question to the owner

  @EARS-16 @core @happy
  Scenario: Stage B precedes merge for every user-facing surface
    Given a 014 surface built from its canvas
    When it is ready for merge
    Then the owner has confirmed the rendered result on the live stand
    And that verdict is recorded before the merge

  # ---------------------------------------------------------------- protocol floor

  @EARS-17 @core @failure
  Scenario Outline: The mutation protocol floor holds on every recording endpoint
    Given a recording mutation request that <defect>
    When it is submitted
    Then it fails with <status> <code>
    And no domain mutation is committed

    Examples:
      | defect                                | status | code                      |
      | omits the Idempotency-Key             | 428    | IDEMPOTENCY_KEY_REQUIRED  |
      | carries a malformed Idempotency-Key   | 400    | IDEMPOTENCY_KEY_INVALID   |
      | omits If-Match on a non-create method | 428    | PRECONDITION_REQUIRED     |
      | carries a stale If-Match              | 412    | PRECONDITION_FAILED       |
      | carries no admin session              | 401    | ADMIN_SESSION_REQUIRED    |
      | carries a session without the role    | 403    | PLATFORM_ADMIN_REQUIRED   |

  @EARS-17 @core @happy
  Scenario: Every committed recording mutation is audited
    Given the generic audit capture of feature 010
    When a recording is attached, published, unpublished, retired or restored
    Then one attributed audit row is appended per committed mutation
    And no 014-specific audit table was introduced

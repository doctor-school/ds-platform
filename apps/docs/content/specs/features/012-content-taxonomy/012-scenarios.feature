# 012 — Content taxonomy scenarios
# Tags map every scenario to the flat EARS clauses in 012-requirements-en.md.
# This is a user-facing spec: admin journeys run through Playwright BDD against
# the real Refine → NestJS → Postgres stack. API/DB-only assertions run in Vitest e2e.

Feature: Operators maintain one retained taxonomy that every Academy surface can query

  Background:
    Given retained-row runtime prerequisite #1278 is merged
    And the admin app is running with an MFA-verified platform_admin session
    And projects, experts, topics, partners and all five joins use restrictive foreign keys
    And public reads default to published entities and active non-deleted joins
    And Stage A has been approved before any taxonomy admin UI slice starts

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @happy
  Scenario Outline: Each entity kind is authored as its own retained draft resource
    When the operator creates a <kind> with its required display label and omits slug
    Then one <table> row is created in draft with stable id, canonical generated slug and version 1
    And the same row appears in that Refine resource list and detail
    And editing it updates that row rather than creating a content copy

    Examples:
      | kind    | table    |
      | project | projects |
      | expert  | experts  |
      | topic   | topics   |
      | partner | partners |

  @EARS-2 @happy
  Scenario: An expert remains a standalone editorial record
    Given a draft expert with name, professional role, credentials, affiliation and bio but no photo
    When the operator saves the expert without selecting a platform user
    Then the expert is saved successfully
    And its admin preview uses deterministic initials instead of fabricating a photo
    And no user link or parallel expert type is created

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-7 @EARS-18 @happy
  Scenario: Authoring controls expose the server contract without masks
    When the operator opens each taxonomy form and the event expert editor
    Then text and textarea fields trim input and show their character limits without input masks
    And slug shows the canonical generated preview plus pattern and length feedback
    And partner website uses a URL control that accepts only absolute HTTPS input
    And event expert position is an integer control from 0 through 32767 with step 1
    And media controls declare JPEG, PNG and WebP plus size and decoded-dimension limits

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-7 @EARS-16 @failure
  Scenario Outline: Malformed authoring input is rejected before mutation or upload
    Given a <kind> authoring request
    When the operator submits <invalid_input>
    Then the request is refused with 400 <error_code> Problem Details
    And no row, media object or audit record changes

    Examples:
      | kind    | invalid_input                                  | error_code        |
      | project | a missing title                                | VALIDATION_FAILED |
      | project | a title longer than 160 characters             | VALIDATION_FAILED |
      | project | slug "Not valid"                              | VALIDATION_FAILED |
      | expert  | a blank name                                   | VALIDATION_FAILED |
      | expert  | a bio longer than 4000 characters              | VALIDATION_FAILED |
      | topic   | a missing title                                | VALIDATION_FAILED |
      | partner | a blank title                                  | VALIDATION_FAILED |
      | partner | an HTTP rather than HTTPS website              | VALIDATION_FAILED |
      | project | a GIF cover                                    | MEDIA_INVALID     |
      | expert  | a photo larger than 10 MiB                     | MEDIA_INVALID     |
      | partner | a logo wider than 6000 decoded pixels          | MEDIA_INVALID     |
      | project | an image containing more than 25 megapixels    | MEDIA_INVALID     |
      | event   | an event expert role longer than 80 characters | VALIDATION_FAILED |
      | event   | event expert position 32768                    | VALIDATION_FAILED |

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-5 @EARS-16 @failure
  Scenario Outline: First publication permanently locks the slug
    Given a draft <kind> whose generated slug the operator edits successfully
    When the operator completes and publishes the <kind>
    Then first_published_at is set once in the publication transaction
    When the operator retires and restores the same <kind>
    And attempts to change its slug with the current If-Match
    Then the request is refused with 409 SLUG_IMMUTABLE Problem Details
    And the original slug and first_published_at remain unchanged

    Examples:
      | kind    |
      | project |
      | expert  |
      | topic   |
      | partner |

  @EARS-5 @happy
  Scenario Outline: A complete entity publishes through a publish-safe allow-list
    Given a complete draft <kind> under its exact field matrix
    And when the kind is project exactly one active curator is a published non-retired expert
    When the operator publishes the <kind>
    Then its status becomes published and deleted_at stays null
    And its public detail returns only the <kind> allow-list with CDN media URLs
    And no storage key or admin-only field is returned

    Examples:
      | kind    |
      | project |
      | expert  |
      | topic   |
      | partner |

  @EARS-5 @EARS-16 @failure
  Scenario Outline: Missing kind-specific fields prevent publication with field errors
    Given a draft <kind> is missing <required_field>
    When the operator attempts to publish the <kind>
    Then the request is refused with 409 PUBLISH_REQUIREMENTS_NOT_MET Problem Details
    And the problem identifies <required_field>
    And the entity remains draft with first_published_at null

    Examples:
      | kind    | required_field    |
      | project | kind              |
      | project | description       |
      | expert  | professional role |
      | expert  | credentials       |
      | expert  | affiliation       |
      | expert  | bio               |

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-5 @happy
  Scenario Outline: Optional fields and empty relationship collections do not block publication
    Given a complete draft <kind> with <empty_or_optional_state>
    When the operator publishes the <kind>
    Then publication succeeds and the public detail is available without authentication
    And no missing relationship, media or website value is fabricated

    Examples:
      | kind    | empty_or_optional_state                                      |
      | project | one eligible curator but zero events, partners and no cover   |
      | expert  | zero events and projects and no photo                         |
      | topic   | zero events                                                    |
      | partner | zero projects and no logo or website                           |

  @EARS-5 @failure
  Scenario Outline: A project without one eligible curator cannot publish
    Given a complete draft project with <curator_state>
    When the operator attempts to publish the project
    Then the request is refused with 409 PUBLISHED_PROJECT_REQUIRES_CURATOR Problem Details
    And the project remains draft

    Examples:
      | curator_state                    |
      | no curator                       |
      | two active curators              |
      | one curator whose expert is draft |
      | one curator whose expert is retired |

  @EARS-6 @happy
  Scenario: One event belongs to several projects and both directions agree
    Given one public event and two published projects
    When the operator creates an active event_projects link for each project
    Then the event-to-projects read returns both projects
    And each project-to-events read returns the same event
    And no event or project lifecycle state changes

  @EARS-7 @EARS-8 @happy
  Scenario: One legacy speaker is migrated explicitly without mutating the source row
    Given an event has active legacy speakers at positions 1 and 2
    And a published expert has the same name as both legacy rows
    When the operator links the expert with a role and position 1 and explicitly selects the first legacy speaker id
    Then one active event_experts row records that exact legacy speaker id
    And the first legacy row remains byte-for-byte active and retained
    And the merged projection emits the expert for the first row and the second legacy row unchanged
    And no name-based deduplication occurs

  @EARS-7 @failure
  Scenario: A cross-event or already-matched legacy speaker cannot be selected
    Given a legacy speaker belongs to another event or is already referenced by a retained event_experts row
    When the operator submits it as legacySpeakerId
    Then the link is refused with 409 Problem Details
    And no inferred or partial mapping is stored

  @EARS-7 @failure
  Scenario Outline: An expert link requires a role and a non-negative integer position
    Given an event and a publishable expert exist
    When the operator submits an event_experts link with <invalid_field>
    Then the request is refused with 400 Problem Details
    And no event_experts row is created or restored

    Examples:
      | invalid_field         |
      | a missing role        |
      | a blank role          |
      | a negative position   |
      | a fractional position |

  @EARS-8 @happy
  Scenario: Speaker fallback and total ordering stay deterministic during partial migration
    Given active linked experts, unmatched active legacy speakers and equal display names
    And one mapped expert is draft and another mapped expert is published
    When the public speaker projection is read repeatedly
    Then the draft expert's matched legacy row remains as fallback
    And the published expert replaces only its explicit legacy row
    And all rows sort by position ascending, expert before legacy, then stable row id
    And repeated reads return the same order

  @EARS-9 @happy
  Scenario: Project experts carry curator or member roles in both directions
    Given a project has one active curator
    When the operator links another expert as member
    Then project-to-experts and expert-to-projects return both links with their roles
    And a second active curator is refused by the database-backed constraint

  @EARS-9 @EARS-17 @happy
  Scenario: A published project's curator is replaced atomically
    Given a published project has one eligible curator and one eligible member
    And the operator holds the current project ETag
    When the operator replaces the curator with that member and a new Idempotency-Key
    Then one transaction promotes the member to curator and demotes the former curator to member
    And the project remains published with exactly one eligible curator at every committed state
    And the project and both affected relationship versions increment
    And one attributed audit row exists for each changed retained row

  @EARS-9 @EARS-13 @EARS-16 @failure
  Scenario Outline: A published project's sole eligible curator cannot be invalidated directly
    Given a published project has exactly one eligible curator
    When the operator attempts to <invalidating_action>
    Then the request is refused with 409 PUBLISHED_PROJECT_REQUIRES_CURATOR Problem Details
    And the project, expert and every relationship keep their status, role, version and deleted_at
    And no audit row is written

    Examples:
      | invalidating_action                    |
      | retire the curator expert              |
      | retire the curator relationship        |
      | demote the curator relationship        |
      | replace the curator with a draft expert |
      | replace the curator with a retired expert |

  @EARS-10 @happy
  Scenario: Project and partner are linked without leaking commercial data
    Given a published project and published partner
    When the operator creates their project_partners link
    Then project-to-partners and partner-to-projects return the same pair
    And the public partner contains only id, slug, title, logo URL and website URL

  @EARS-11 @happy
  Scenario: Event topics are curated and independent from specialties
    Given an event has specialties "cardiology" and "therapy"
    And a non-retired curated topic exists
    When the operator selects that topic on the event form
    Then one event_topics row is active and both directions return it
    And the specialties array remains byte-for-byte unchanged
    And the event form offers no inline topic creation control

  @EARS-12 @happy
  Scenario Outline: Every public relationship direction uses the canonical cursor envelope
    Given published endpoints joined by an active <join>
    When a public caller reads <forward> and <reverse> with a bounded limit
    Then each response has data and pagination with nextCursor and hasMore
    And following nextCursor returns no duplicate logical pair
    And the records come from the authored rows

    Examples:
      | join             | forward                  | reverse                  |
      | event_projects   | event-to-projects        | project-to-events        |
      | event_experts    | event-to-experts         | expert-to-events         |
      | project_experts  | project-to-experts       | expert-to-projects       |
      | project_partners | project-to-partners      | partner-to-projects      |
      | event_topics     | event-to-topics           | topic-to-events           |

  @EARS-12 @failure
  Scenario Outline: A non-public endpoint or retired join cannot leak through traversal
    Given a relationship whose <hidden_part> is not publicly eligible
    When a public caller reads either direction
    Then the hidden relation is absent
    And a direct public detail for a draft, retired or unknown taxonomy id has the same 404 body

    Examples:
      | hidden_part       |
      | taxonomy endpoint |
      | join              |

  @EARS-13 @happy
  Scenario: Retirement is previewed and changes no related lifecycle state
    Given a published expert linked to current public events and projects only as a member rather than their sole curator
    When the operator requests the expert's retirement impact
    Then the admin shows affected public identifiers and the current version
    When the operator confirms retire with that If-Match and a new Idempotency-Key
    Then the expert becomes retired with deleted_at set and version incremented
    And every expert row, join and foreign key remains stored
    And no linked event, project or join changes status

  @EARS-14 @happy
  Scenario: A retained entity and relation restore under the same stable identities
    Given a retired entity and retired relationship are visible through includeRetired and direct admin detail
    When the operator restores both with current If-Match values
    Then the entity is draft with deleted_at null
    And the relationship is active with deleted_at null
    And their ids and historical relationships are unchanged
    And no Delete route or Delete control exists

  @EARS-15 @happy
  Scenario: Admin lists search and page while excluding retained rows by default
    Given active, draft and retired taxonomy rows exist
    When the operator searches title, name or slug and changes page and page size
    Then the Refine table returns the matching bounded page and total
    And retired rows appear only after an explicit status or includeRetired filter
    And retired rows never appear in a new-link selector
    And an empty page is a successful empty response

  @EARS-16 @failure
  Scenario Outline: Authorization and protocol failures are exact Problem Details
    Given the request condition is <condition>
    When the caller invokes the corresponding taxonomy route
    Then the response status is <status>
    And the application/problem+json body contains a stable errorCode and traceId

    Examples:
      | condition                         | status |
      | admin route without authentication | 401    |
      | admin route as doctor_guest        | 403    |
      | invalid cursor                     | 400    |
      | duplicate retained pair            | 409    |
      | duplicate retained slug            | 409    |
      | invalid lifecycle transition       | 409    |
      | malformed authoring field          | 400    |
      | invalid media binary               | 400    |
      | incomplete publish projection      | 409    |
      | immutable slug change              | 409    |
      | published curator invalidation     | 409    |
      | missing If-Match                   | 428    |
      | stale If-Match                     | 412    |

  @EARS-17 @happy
  Scenario: Idempotent replay and optimistic concurrency prevent duplicate or lost writes
    Given an active Idempotency-Key and a row at version 3
    When the same actor repeats the same route and payload with that key
    Then the original status and body are replayed without another mutation or audit row
    When two different updates both submit If-Match version 3
    Then exactly one succeeds and increments the row to version 4
    And the other returns 412 without mutation
    And the successful mutation has one attributed feature-010 audit record

  @EARS-17 @failure
  Scenario: An idempotency key cannot be reused for a different request
    Given an active Idempotency-Key has completed for one actor, normalized route and payload hash
    When that actor submits a different payload hash to the same route with the same key
    Then the server returns 409 IDEMPOTENCY_KEY_REUSED Problem Details
    And no domain row, media reference or audit row changes

  @EARS-17 @failure
  Scenario: Idempotency records expire by retained update and are never reused
    Given an active idempotency record has reached its 24 hour boundary
    When the expiry process runs
    Then the row is updated to expired with deleted_at set
    And the row remains stored forever
    And the stable key cannot be reactivated, reused or physically deleted

  @EARS-13 @EARS-17 @failure
  Scenario: A stale retirement preview cannot authorize retirement
    Given an operator previewed retirement at version 4
    And another valid edit advanced the row to version 5
    When the operator confirms retirement with If-Match version 4
    Then the server returns 412
    And no row or relationship is retired
    And the admin reloads impact before asking for confirmation again

  @EARS-18 @happy
  Scenario: The approved Refine composition is implemented and re-confirmed live
    Given the design-system inventory and approved-registry research are recorded
    And the product owner selected one of 2 to 3 Stage-A Refine composition options
    When the taxonomy admin journey is driven on the live stand
    Then it uses design-system primitives with complete hover, active, focus, disabled and loading states
    And no Delete action or hand-built replacement control exists
    And create, link, reject, retire and restore states pass Playwright and axe at both breakpoints and themes
    And merge remains blocked until the product owner records the Stage-B confirmation

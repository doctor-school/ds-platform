# 012 — Content taxonomy scenarios
# Tags map every scenario to the flat EARS clauses in 012-requirements-en.md.
# This is a user-facing spec: admin journeys run through Playwright BDD against
# the real Refine → NestJS → Postgres stack. API/DB-only assertions run in Vitest e2e.

Feature: Operators maintain one retained taxonomy that every Academy surface can query

  Background:
    Given expert and legacy-speaker PD prerequisite #1305 has fresh Product Lead and Legal/Compliance sign-off before another affected speaker write or expert migration
    And retained-row runtime prerequisite #1278 is merged after that masking and historical-remediation proof
    And token-free admin authority prerequisite #1304 is merged before any taxonomy mutation
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

  @EARS-1 @EARS-2 @EARS-4 @happy
  Scenario Outline: Every public taxonomy image crosses one shared normalizer
    Given a valid <kind> image contains EXIF XMP GPS an original filename and ancillary metadata
    When the operator uploads it with a canonical UUID Idempotency-Key
    Then the #1283 shared component decodes and re-encodes a canonical JPEG PNG or WebP output
    And stored MIME is derived from the normalized bytes
    And only the normalized object is stored under a server-generated key
    And no original bytes filename location or ancillary metadata reaches object storage or CDN

    Examples:
      | kind          |
      | project cover |
      | expert photo  |
      | partner logo  |

  @EARS-1 @EARS-2 @EARS-4 @EARS-17 @failure
  Scenario Outline: A committed media replacement or clear retains its old-reference cleanup obligation
    Given a taxonomy row references an old normalized <kind> object with versions derivatives and a CDN key
    When a valid <operation> commits and immediate old-object deletion is unavailable
    Then the same database transaction changes or clears the media ref and inserts an active pending retained media_cleanup_jobs row for the old key
    And the successful content mutation is not rolled back or mistaken for claim-scoped new-upload cleanup
    When the leased cleanup worker retries after storage recovers
    Then a newer fenced lease epoch rechecks that the old object is unreferenced deletes every version and derivative and purges or invalidates the CDN key
    And matching-owner completion sets expired completed and deleted_at while clearing raw keys entity linkage lease and error content
    And it retains only job id cleanup kind outcome and timestamps as the non-content tombstone
    And the audited domain ref change exists while the technical cleanup row is covered by the explicit feature-010 exclusion parity guard

    Examples:
      | kind          | operation         |
      | project cover | replacement       |
      | expert photo  | mediaAction clear |
      | partner logo  | replacement       |

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-7 @EARS-18 @happy
  Scenario: Authoring controls expose the server contract without masks
    When the operator opens each taxonomy form and the event expert editor
    Then every input-mask declaration is none because no field is a fixed-format identifier
    And text and textarea fields trim input and show their character limits
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

  @EARS-1 @EARS-2 @EARS-4 @EARS-17 @happy
  Scenario Outline: Media-capable entities use one exact request shape
    Given the operator is creating or editing a <kind>
    When the request uses <request_shape> with a new Idempotency-Key
    Then the server accepts the request shape without accepting a client storage key
    And exactly one retained entity mutation and domain audit row commit

    Examples:
      | kind    | request_shape                                                                  |
      | project | application/json without a binary                                              |
      | project | multipart/form-data with one JSON payload and one kind-specific cover file    |
      | expert  | application/json without a binary                                              |
      | expert  | multipart/form-data with one JSON payload and one kind-specific photo file    |
      | partner | application/json without a binary                                              |
      | partner | multipart/form-data with one JSON payload and one kind-specific logo file     |

  @EARS-1 @EARS-2 @EARS-4 @EARS-16 @failure
  Scenario Outline: Ambiguous or authority-bearing media input is rejected before upload
    Given a media-capable entity request uses <invalid_shape>
    When the operator submits it with a new Idempotency-Key
    Then the server returns <status> <error_code> Problem Details
    And no object, domain row or domain audit row changes

    Examples:
      | invalid_shape                                      | status | error_code              |
      | multipart/form-data without a file                 | 415    | UNSUPPORTED_MEDIA_TYPE  |
      | a file together with mediaAction clear             | 400    | MEDIA_INPUT_CONFLICT    |
      | multiple or wrong kind-specific file parts         | 400    | MEDIA_INPUT_CONFLICT    |
      | a client-supplied coverRef photoRef or logoRef      | 400    | VALIDATION_FAILED       |

  @EARS-1 @EARS-2 @EARS-4 @EARS-16 @EARS-17 @failure
  Scenario: Object-storage failure has an exact replayable outcome
    Given a valid media upload owns a fresh idempotency claim
    When object storage refuses the PUT
    Then the server returns 503 MEDIA_STORAGE_UNAVAILABLE Problem Details
    And no taxonomy entity, speaker-domain or domain audit row changes
    And the same key and fingerprint replay that 503 outcome without another PUT

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-5 @EARS-16 @failure
  Scenario Outline: Ordinary first publication permanently locks the slug
    Given a draft <kind> whose generated slug the operator edits successfully
    When the operator completes and publishes the <kind>
    Then first_published_at is set once in the publication transaction
    When the operator retires and restores the same <kind> after each transition-specific impact preview and confirmation
    And attempts to change its slug with the current If-Match
    Then the request is refused with 409 SLUG_IMMUTABLE Problem Details
    And the original slug and first_published_at remain unchanged

    Examples:
      | kind    |
      | project |
      | expert  |
      | topic   |
      | partner |

  @EARS-2 @EARS-16 @failure
  Scenario: Historical legacy-speaker audit PD is classified before expert migration
    Given historical audit_ledger data.event_speakers insert and update diffs may contain plaintext name or regalia
    When the #1305 pre-migration inventory runs
    Then SQL audit_pd_columns and TS AUDIT_PD_COLUMNS first gain every expert PD field plus event_speakers name and regalia with parity
    And every historical hit receives an explicit Legal/Compliance classification term owner and approved append-only-safe encryption or crypto-shred remediation
    And raw ledger output contains no unclassified plaintext marker while retained evidence rows remain
    And no expert migration or further unmasked affected write may start before that proof passes

  @EARS-2 @EARS-8 @EARS-14 @EARS-16 @EARS-17 @failure
  Scenario: Lawful expert PD erasure preserves exact tombstones but cannot be restored
    Given the Product Lead and Legal/Compliance freshly approved the exact #1305 policy and erasure request
    And the command carries the current expert ETag and a canonical UUID Idempotency-Key
    And every sole-curator project has an explicit eligible-replacement or retire-project resolution
    And the expert has a published-history slug photo joins one explicitly mapped legacy speaker and active completed idempotency replay content
    When the compliance command locks all subject and replacement experts projects events and child rows in canonical order and commits erasure
    Then the experts row keeps its stable id and first_published_at with status retired and non-null deleted_at and pd_erased_at
    And slug is erased-stable-id and name is the fixed erased sentinel while professional role credentials affiliation bio and photo_ref are null
    And a mandatory unique stable-Vault-HMAC reservation digest rejects old-slug reuse without retaining the readable old slug
    And the explicitly mapped event_speakers row remains retained and retired with non-null deleted_at and pd_erased_at name set to the erased sentinel and regalia empty
    And unmatched legacy rows are never guessed by name
    And subject event_experts are retired with role erased and legacy_speaker_id null while project_experts are retired and any former curator role is member
    And stable endpoint ids and position remain non-public only under the signed pseudonymous evidence basis and term
    And every active claim whose sorted pd_subject_refs contains that expert advances its fence expires and clears response headers fingerprint upload target actor and subject content
    And a paused claim owner cannot complete after erasure and every later affected-key use returns IDEMPOTENCY_KEY_REUSED
    And the transaction writes durable media CDN public JSON HTML card cache and registered search-index cleanup jobs and leaves the request executing
    And the admin exposes no restore control for the erased expert
    When the operator attempts restore with current headers
    Then the server returns 409 PD_ERASED Problem Details without changing a row media object or audit record

  @EARS-2 @EARS-8 @EARS-16 @failure
  Scenario: External erasure acknowledgement is retried without republishing database PD
    Given an expert erasure database transaction committed exact tombstones and durable cleanup jobs
    And object storage CDN or one registered cache or search-index consumer is unavailable
    When the erasure worker cannot collect every acknowledgement
    Then the request remains executing with retries and an alert and erased database values are never rolled back or republished
    When every photo version derivative and CDN key is absent and all public JSON HTML card and search projections acknowledge invalidation
    Then old expert profile media and speaker URLs return the ordinary unknown or ineligible response
    And red-team marker scans find no plaintext in raw audit output APIs pages CDN caches indexes logs or metrics
    And the erasure request becomes completed within the approved term of at most 30 days

  @EARS-2 @EARS-8 @EARS-14 @EARS-16 @EARS-17 @failure
  Scenario: A legacy-only person has an explicit retained-row erasure path
    Given one event_speakers row identifies a person but has no expert or explicit mapping
    And Legal/Compliance approved erasure for that stable eventSpeakerId
    And the command carries the current speaker-row ETag and a canonical UUID Idempotency-Key
    When EraseLegacySpeakerPd runs with that id
    Then that row remains retained and retired with non-null deleted_at and pd_erased_at name set to the erased sentinel and regalia empty
    And no other same-name speaker row is selected or changed
    And future audit values are masked and public caches no longer contain that speaker PD
    And the event editor exposes no restore control for that row
    When the event editor attempts to restore or repopulate that stable row
    Then the request returns 409 PD_ERASED with no row or audit mutation

  @EARS-2 @EARS-5 @EARS-9 @EARS-16 @EARS-17 @failure
  Scenario Outline: Expert erasure resolves every published sole-curator project atomically
    Given the erasure subject is sole eligible curator of a published project
    And the approved curator resolution is <resolution>
    When erasure races curator replacement or project publication under the shared expert-to-project lock order
    Then <committed_project_result>
    And no committed published project has the erased or retired subject as its curator
    And a losing concurrent command revalidates or retries without an invalid intermediate state

    Examples:
      | resolution                   | committed_project_result                                                        |
      | eligible replacement expert | the project stays published with exactly that one eligible replacement curator |
      | retire project               | the project is retired and absent from catalog and direct detail with joins kept |

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

  @EARS-1 @EARS-2 @EARS-5 @EARS-16 @EARS-17 @failure
  Scenario Outline: A published entity cannot be edited into an incomplete projection
    Given a published <kind> at a current version with <required_field> populated
    When the operator PATCHes <required_field> to null with the target If-Match and a new Idempotency-Key
    Then the request is refused with 409 PUBLISH_REQUIREMENTS_NOT_MET Problem Details
    And the problem identifies <required_field>
    And the stored value and version remain unchanged
    And no domain audit row is written

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
    Then the link is refused with 409 LEGACY_SPEAKER_CONFLICT Problem Details
    And event_speakers uses UUID id as row identity plus a partial active event_id-position unique explicit event_id-id composite FK target and irreversible pd_erased_at CHECK
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

  @EARS-5 @EARS-7 @EARS-8 @EARS-13 @EARS-16 @EARS-17 @failure
  Scenario Outline: Every speaker-visibility mutation shares the event serialization boundary
    Given an event whose current visible speaker slots are valid
    And <visibility_setup>
    When <visibility_change> races with <competing_write>
    Then event-expert writes lock every affected expert before every affected parent event in canonical order
    And exactly one conflicting command commits
    And the loser revalidates and returns 409 SPEAKER_POSITION_OCCUPIED Problem Details
    And every committed public projection has at most one visible row per position
    And the losing command writes no domain or audit mutation

    Examples:
      | visibility_setup                                                    | visibility_change                    | competing_write                                  |
      | an eligible unpaired expert is not yet linked                       | link that expert at position 3       | legacy reconciliation moves a row to position 3 |
      | a draft expert is unlinked while legacy occupies position 3        | publish that expert                  | create its unpaired link at position 3          |
      | a draft unpaired expert is linked at position 3                     | publish that expert                  | legacy reconciliation moves a row to position 3 |
      | an eligible expert suppresses a legacy row at position 3            | retire that mapped expert            | link an unpaired expert at position 3            |

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
    Then one transaction demotes the former curator to member before promoting the replacement
    And an immediate uniqueness failure during promotion rolls the whole transaction back to the former curator
    And the project remains published with exactly one eligible curator at every committed state
    And the project and both affected relationship versions increment
    And one attributed audit row exists for each changed retained row

  @EARS-9 @EARS-13 @EARS-16 @EARS-17 @failure
  Scenario: Curator replacement and candidate-expert retirement preserve eligibility under a race
    Given a published project has one eligible curator and an eligible member selected as replacement
    And replacement carries the current project ETag while retirement carries the current candidate-expert ETag
    When replacing the curator with that candidate races with retiring the candidate expert
    Then both commands use the shared expert-first and project-second lock order
    And exactly one command commits
    And the loser revalidates and returns 409 PUBLISHED_PROJECT_REQUIRES_CURATOR Problem Details
    And the project remains published with exactly one active curator whose expert is published and non-retired
    And only the committed command writes its domain and audit mutations

  @EARS-5 @EARS-9 @EARS-16 @EARS-17 @failure
  Scenario: Project publication restarts when its optimistically discovered curator changes
    Given project publication discovered one eligible curator before locking
    And the curator relation changes before the expert-first lock set is acquired
    When publication reaches post-lock revalidation
    Then it returns 412 PRECONDITION_FAILED without locking a newly discovered expert after the project
    And no project status version or audit row changes
    And a retry rediscovers and locks the complete expert set before the project

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

  @EARS-8 @EARS-12 @happy
  Scenario Outline: Every public relationship route returns its exact item DTO
    Given a publicly eligible source and related endpoint for <route>
    When a zero-auth caller reads that relationship collection
    Then each item is exactly <item_dto>
    And no join id, lifecycle status, storage key or admin-only field is present

    Examples:
      | route                | item_dto                                                    |
      | event-to-projects    | PublicProjectSummary                                        |
      | project-to-events    | PublicEventSummary                                          |
      | event-to-experts     | PublicExpertSummary plus role and position                  |
      | expert-to-events     | PublicEventSummary plus role and position                   |
      | project-to-experts   | PublicExpertSummary plus curator-or-member role             |
      | expert-to-projects   | PublicProjectSummary plus curator-or-member role            |
      | project-to-partners  | PublicPartnerSummary                                        |
      | partner-to-projects  | PublicProjectSummary                                        |
      | event-to-topics      | PublicTopicSummary                                          |
      | topic-to-events      | PublicEventSummary                                          |

  @EARS-8 @EARS-12 @happy
  Scenario: One merged-speaker resolver feeds the event endpoint, page and upcoming card
    Given an eligible event has mapped experts, an unmatched legacy row and a draft-expert fallback
    When its speakers endpoint, PublicEventPage and UpcomingBroadcastCard are read
    Then the endpoint and page return the same ordered exact legacy-or-expert discriminated union
    And the card returns the same order mapped to exactly name-only items
    And no surface runs a second merge policy or returns an optional expert field ambiguously

  @EARS-12 @failure
  Scenario Outline: A non-public endpoint or retired join cannot leak through traversal
    Given a relationship whose <hidden_part> is not publicly eligible
    When a public caller reads either direction
    Then the hidden relation is absent
    And a direct public detail for a draft, retired or unknown taxonomy id has the same 404 RESOURCE_NOT_FOUND body

    Examples:
      | hidden_part       |
      | taxonomy endpoint |
      | join              |

  @EARS-12 @EARS-16 @happy
  Scenario: An eligible source with no eligible relations is distinct from an ineligible source
    Given one public source has no eligible related rows and another source is draft, retired or unknown
    When a zero-auth caller reads the same relationship direction for each source
    Then the eligible source returns 200 with empty data, null nextCursor and hasMore false
    And the ineligible source returns 404 RESOURCE_NOT_FOUND Problem Details

  @EARS-13 @happy
  Scenario: Retirement is previewed and changes no related lifecycle state
    Given a published expert linked to current public events and projects only as a member rather than their sole curator
    When the operator requests lifecycle impact for transition retire
    Then the admin shows affected public identifiers, the current version and a signed opaque impactToken
    When the operator confirms retire with that If-Match, Lifecycle-Impact-Token and a new Idempotency-Key
    Then the expert becomes retired with deleted_at set and version incremented
    And every expert row, join and foreign key remains stored
    And no linked event, project or join changes status

  @EARS-14 @happy
  Scenario: A retained entity and relation restore under the same stable identities
    Given a retired entity and retired relationship are visible through includeRetired and direct admin detail
    When the operator previews transition restore for each target
    Then each preview shows the surfaces that restore would add and its signed impactToken
    When the operator restores each with its current If-Match, matching Lifecycle-Impact-Token and a new Idempotency-Key
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
    Then the response is <status> <error_code> application/problem+json
    And the body contains a traceId and no hidden lifecycle or database detail

    Examples:
      | condition                                             | status | error_code                           |
      | no dedicated admin session                            | 401    | ADMIN_SESSION_REQUIRED                |
      | only a doctor portal cookie                           | 401    | ADMIN_SESSION_REQUIRED                |
      | an admin session without verified MFA                 | 401    | ADMIN_SESSION_REQUIRED                |
      | missing or mismatched CSRF on a mutation              | 401    | ADMIN_SESSION_REQUIRED                |
      | an inactive missing or mismatched provider session   | 401    | ADMIN_SESSION_REQUIRED                |
      | an active provider session whose current role was revoked | 403 | PLATFORM_ADMIN_REQUIRED             |
      | IdP transport timeout 429 5xx service-auth config or malformed response | 503 | IDP_REVALIDATION_UNAVAILABLE |
      | invalid cursor                                        | 400    | CURSOR_INVALID                        |
      | unknown or ineligible public source                   | 404    | RESOURCE_NOT_FOUND                    |
      | duplicate retained pair                               | 409    | RELATIONSHIP_CONFLICT                 |
      | duplicate retained slug                               | 409    | SLUG_CONFLICT                         |
      | invalid lifecycle transition                          | 409    | INVALID_TRANSITION                    |
      | malformed authoring field                             | 400    | VALIDATION_FAILED                     |
      | malformed or non-canonical idempotency UUID           | 400    | IDEMPOTENCY_KEY_INVALID               |
      | invalid media binary                                  | 400    | MEDIA_INVALID                         |
      | ambiguous media input                                 | 400    | MEDIA_INPUT_CONFLICT                  |
      | unsupported media request content type                | 415    | UNSUPPORTED_MEDIA_TYPE                |
      | unavailable object storage                            | 503    | MEDIA_STORAGE_UNAVAILABLE             |
      | incomplete publish projection                         | 409    | PUBLISH_REQUIREMENTS_NOT_MET          |
      | immutable slug change                                 | 409    | SLUG_IMMUTABLE                        |
      | restore of a PD-erased expert                         | 409    | PD_ERASED                             |
      | published curator invalidation                        | 409    | PUBLISHED_PROJECT_REQUIRES_CURATOR    |
      | conflicting legacy speaker match                      | 409    | LEGACY_SPEAKER_CONFLICT               |
      | occupied combined speaker slot                        | 409    | SPEAKER_POSITION_OCCUPIED             |
      | live idempotency owner exceeded bounded waiter time   | 409    | IDEMPOTENCY_REQUEST_IN_PROGRESS       |
      | missing If-Match on a conditional method              | 428    | PRECONDITION_REQUIRED                 |
      | stale If-Match                                        | 412    | PRECONDITION_FAILED                   |
      | missing lifecycle impact token                        | 428    | LIFECYCLE_IMPACT_REQUIRED             |
      | stale lifecycle impact token                          | 412    | LIFECYCLE_IMPACT_STALE                |

  @EARS-16 @EARS-17 @failure
  Scenario: Token-free live authority revalidation precedes every mutation side effect
    Given the dedicated admin session stores a Zitadel session id and sub but no IdP access or refresh token
    When an otherwise valid mutation passes local session fingerprint MFA and CSRF checks
    Then IdpClient revalidateAdminAuthority uses service authentication to read that session and current project role
    And request validation idempotency ownership normalization upload and handler entry wait for its positive verdict
    And provider inability to decide leaves the local session intact and returns IDP_REVALIDATION_UNAVAILABLE with zero side effect

  @EARS-16 @EARS-17 @failure
  Scenario Outline: An absent or invalid idempotency UUID is rejected before side effects
    Given an otherwise valid mutating request with current preconditions
    When its Idempotency-Key header is <header_state>
    Then the server returns <status> <error_code> Problem Details
    And no upload, idempotency row, domain row or domain audit row is created or changed

    Examples:
      | header_state              | status | error_code                 |
      | omitted                   | 428    | IDEMPOTENCY_KEY_REQUIRED   |
      | blank                     | 428    | IDEMPOTENCY_KEY_REQUIRED   |
      | not a UUID                | 400    | IDEMPOTENCY_KEY_INVALID    |
      | non-canonical UUID text   | 400    | IDEMPOTENCY_KEY_INVALID    |

  @EARS-16 @EARS-17 @happy
  Scenario: Create methods require no invented aggregate precondition
    Given a valid entity create and a valid relationship create each have a new canonical UUID Idempotency-Key
    When each POST is sent without If-Match
    Then each create may succeed and returns its representation ETag and Location when applicable

  @EARS-16 @EARS-17 @failure
  Scenario Outline: Conditional mutation methods require the exact relevant ETag
    Given an otherwise valid <method> request with every other required header
    When it omits <required_etag>
    Then the server returns 428 PRECONDITION_REQUIRED Problem Details
    And no domain or audit mutation occurs

    Examples:
      | method          | required_etag |
      | PATCH           | target ETag   |
      | publish         | target ETag   |
      | retire          | target ETag   |
      | restore         | target ETag   |
      | replace-curator | project ETag  |
      | erase expert    | expert ETag   |
      | erase legacy speaker | speaker ETag |

  @EARS-17 @happy
  Scenario: Idempotent replay preserves the original representation metadata
    Given an active completed Idempotency-Key whose response stored status, body, ETag and Location
    And the resource has since advanced beyond that stored ETag
    When the same actor repeats the same route and payload with that key
    Then the original status, body, ETag and Location are replayed without another mutation or audit row

  @EARS-17 @happy
  Scenario: Optimistic concurrency prevents a lost write
    Given another row is at version 3
    When two different updates both submit If-Match version 3
    Then exactly one succeeds and increments the row to version 4
    And the other returns 412 PRECONDITION_FAILED without mutation
    And the successful mutation has one attributed feature-010 audit record

  @EARS-17 @failure
  Scenario Outline: An idempotency key cannot authorize different semantic input
    Given an active Idempotency-Key has completed for one actor and complete request fingerprint
    When that actor repeats the key with <changed_input>
    Then the server returns 409 IDEMPOTENCY_KEY_REUSED Problem Details
    And no domain row, media reference or audit row changes

    Examples:
      | changed_input                                      |
      | a different canonical payload                      |
      | a different concrete target id                     |
      | the same JSON with a different normalized output digest |
      | the same payload with a different If-Match         |
      | the same payload with a different lifecycle token  |

  @EARS-16 @EARS-17 @failure
  Scenario: A live idempotency owner gives concurrent waiters a bounded response
    Given one owner holds a renewable idempotency lease and remains processing
    When a same-fingerprint waiter has waited for 2 seconds without completion
    Then the waiter returns 409 IDEMPOTENCY_REQUEST_IN_PROGRESS with Retry-After 1
    And it performs no upload, domain or audit mutation

  @EARS-17 @failure
  Scenario: Request takeover fences a paused media owner from domain commit
    Given request owner A at lease_epoch 7 recorded its deterministic object key and paused after PUT before domain commit
    When its 60-second request lease expires and request owner B wins the CAS at lease_epoch 8
    Then B HEADs and verifies the normalized digest and reuses that exact unreferenced object or uploads with If-None-Match only if absent
    When A resumes and attempts claim completion with owner A epoch 7 and purpose request
    Then its fencing update affects zero rows and the same transaction rolls back every domain and audit write
    And B alone may commit one completed domain mutation and audit result

  @EARS-16 @EARS-17 @failure
  Scenario Outline: Every deterministic post-claim refusal is fenced and replayed exactly
    Given one request owner holds an active claim at a current lease_epoch
    When post-lock handling deterministically returns <status> <error_code>
    Then owner epoch and purpose conditionally complete that exact status body and allowed headers
    And no refused domain or domain-audit mutation commits
    When the same actor repeats the complete fingerprint with that key after underlying state changes
    Then the original refusal is replayed without re-executing the handler

    Examples:
      | status | error_code                           |
      | 409    | PUBLISHED_PROJECT_REQUIRES_CURATOR   |
      | 409    | SPEAKER_POSITION_OCCUPIED            |
      | 412    | PRECONDITION_FAILED                  |
      | 412    | LIFECYCLE_IMPACT_STALE               |

  @EARS-17 @failure
  Scenario: An indeterminate provider or database fault remains takeover eligible
    Given a request owns a claim but receives an unclassified provider timeout database disconnect or uncertain commit verdict
    When its transaction cannot prove a deterministic result
    Then it stores no terminal replay outcome and commits no domain or audit mutation
    And after lease expiry a new fenced request owner re-runs every post-lock precondition

  @EARS-17 @failure
  Scenario: Orphan cleanup uses a separate fenced lease and never enters the domain handler
    Given a request owner crashed after PUT and no retry arrived through the cleanup grace
    When the cleanup worker CAS-acquires purpose cleanup with a newer lease_epoch
    Then it checks domain references without invoking the taxonomy handler
    And it deletes the unreferenced object and records cleanup outcome plus abandoned state
    And a stale request owner cannot complete under the cleanup epoch
    And recurring reconciliation keeps checking the deterministic non-content cleanup handle
    And a late stale-owner PUT after an earlier delete is found and removed on a later sweep
    When a later same-fingerprint request acquires a newer purpose request epoch
    Then it re-uploads only if the object is absent and still produces at most one domain mutation

  @EARS-17 @failure
  Scenario: Idempotency expiry retains the tombstone but minimizes cached content
    Given an active idempotency record has reached its 24 hour boundary
    When the expiry process runs
    Then the row is updated to expired with deleted_at set
    And cached response body headers request fingerprint file digest object key domain target pd_subject_refs lease owner purpose and actor digest are cleared
    And that content clearing succeeds even while object storage is unavailable
    And the previous actor-digest key version is destroyed after the 24-hour window and cleanup grace
    And only key digest method route template status lifecycle timestamps and a temporary non-content cleanup handle or outcome remain
    And no raw Idempotency-Key or admin sub remains
    And recurring cleanup retains the handle until no unreferenced object remains
    And a later same-scope request with that key returns 409 IDEMPOTENCY_KEY_REUSED even for the same fingerprint
    And the stable key cannot be reactivated, reused or physically deleted
    And no feature-010 audit row is expected for the allow-listed technical table

  @EARS-13 @EARS-14 @EARS-16 @EARS-17 @failure
  Scenario Outline: A stale lifecycle preview cannot authorize a transition
    Given an operator previewed <transition> at version 4 and received its signed impactToken
    And another valid edit advanced the row to version 5
    When the operator confirms <transition> with If-Match version 4 and that Lifecycle-Impact-Token
    Then the server returns 412 LIFECYCLE_IMPACT_STALE Problem Details
    And no lifecycle state, relationship, media or domain audit row changes
    And the admin reloads impact before asking for confirmation again

    Examples:
      | transition |
      | retire     |
      | restore    |

  @EARS-13 @EARS-14 @EARS-16 @EARS-17 @failure
  Scenario Outline: A signed lifecycle token cannot cross its exact authority boundary
    Given an operator has a current target ETag and a signed 15-minute lifecycle impact token
    When confirmation uses <token_abuse>
    Then the server returns 412 LIFECYCLE_IMPACT_STALE Problem Details
    And no lifecycle state relationship media idempotency-domain result or audit row changes
    And the admin reloads impact before asking for confirmation again

    Examples:
      | token_abuse                                      |
      | a tampered signature                             |
      | a retire token for restore                       |
      | a valid token for another target                 |
      | a token after its 15-minute expiry               |

  @EARS-13 @EARS-14 @EARS-16 @EARS-17 @failure
  Scenario Outline: A dependency change invalidates lifecycle impact without advancing the target version
    Given an operator previewed <transition> and received its current target ETag and signed impactToken
    And after preview <dependency_change> while the target version stays unchanged
    When the operator confirms <transition> with that If-Match and Lifecycle-Impact-Token
    Then the server returns 412 LIFECYCLE_IMPACT_STALE Problem Details
    And a relationship command never locks its target before the applicable expert project or event dependencies
    And no target, relationship, media or domain audit row changes
    And the admin reloads the complete lifecycle impact before asking again

    Examples:
      | transition | dependency_change                                      |
      | retire     | an incident retained relationship is added or restored |
      | retire     | an opposite endpoint changes public eligibility        |
      | restore    | an incident relationship is retired                    |
      | restore    | an opposite endpoint changes public eligibility        |

  @EARS-18 @happy
  Scenario: The approved Refine composition is implemented and re-confirmed live
    Given the design-system inventory and approved-registry research are recorded
    And the product owner selected one of 2 to 3 Stage-A Refine composition options
    When the taxonomy admin journey is driven on the live stand
    Then it uses design-system primitives with complete hover, active, focus, disabled and loading states
    And no Delete action or hand-built replacement control exists
    And create, link, reject, retire and restore states pass Playwright and axe at both breakpoints and themes
    And merge remains blocked until the product owner records the Stage-B confirmation

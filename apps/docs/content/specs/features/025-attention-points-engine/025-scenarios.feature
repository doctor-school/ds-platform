# 025 — Attention points engine — scenarios
# Tags map every scenario to the flat EARS clauses in 025-requirements-en.md.
# This is a backend-only spec: each scenario is executed by the Vitest e2e named
# in the requirements' Verification table against the real apps/api -> Postgres
# stack. Facts come from their producer features (021, 022, 024, 020, the room)
# through points.record; amounts in brackets are rule-version parameters with
# the PRD defaults.

@host:admin
Feature: One attention-points ledger accrues, reserves, debits and releases Pul, Bre and Con

  Background:
    Given the rule book holds the seeded engine rules and settings with the PRD defaults
    And a doctor "A" of specialty "Кардиология" with a verified phone

  @EARS-1 @EARS-2 @EARS-3 @EARS-5 @EARS-6 @EARS-14 @EARS-19 @EARS-9 @happy
  Scenario: Registration to the first event
    Given doctor "A" has no points account
    When the facts "account.registered" and "phone.verified" for "A" are recorded
    Then exactly one attention-points account exists for "A"
    And "A" has 20 Pul available, each posting carrying rule "accrual.registration" version 2
    When the fact "profile.verified" for "A" is recorded
    Then "A" has 50 Pul available and 2 Bre
    When "A" registers for a threshold-mode event "E" priced 50 Pul
    Then a reserve of 50 Pul is posted and "A" has 0 Pul available and 50 Pul reserved
    When "attendance.confirmed" is recorded for "A" on "E" with a presence share of 45 %
    Then the hold is settled once
    And "A" has 0 Pul, 4 Bre and 1 Con

  @EARS-4 @EARS-7
  @points-record-boundaries
  Scenario: The same lesson reported from two storefronts and an offline sync accrues once
    When "lesson.completed" for "A" on lesson "L1" is recorded from the doctor storefront
    And "lesson.completed" for "A" on lesson "L1" is recorded from the Academy with another event id
    And the mobile offline sync replays the first "lesson.completed" for "A" on lesson "L1"
    Then exactly one lesson award of 10 Pul and 1 Bre is posted for "A" on "L1"
    And the second and third answers are "duplicate"

  @EARS-7 @failure
  @points-engine-originals
  Scenario: An offline lesson earns Bre only and never a second Bre
    When "lesson.completed" for "A" on lesson "L5" is recorded with mode "offline"
    Then a posting of 1 Bre and no Pul is written under rule "accrual.lesson.any-mode"
    When "lesson.completed" for "A" on lesson "L5" is recorded with mode "online" and another event id
    Then 10 Pul are posted under rule "accrual.lesson" and "accrual.lesson.any-mode" is traced "limit-reached"
    And "A" has 10 Pul and 1 Bre from lesson "L5"
    When "lesson.completed" for "A" on lesson "L5" is recorded with mode "offline" and a third event id
    Then the answer is "duplicate" and nothing is posted

  @EARS-15 @EARS-20
  @points-advance-boundaries
  Scenario: Advance covers the shortfall and later earnings settle it
    Given "A" has 20 Pul available
    And an advance-mode event "E2" priced 50 Pul
    When "A" registers for "E2"
    Then 20 Pul are reserved from the balance and 30 Pul are covered by an advance
    And "A" has an open obligation of 30 Pul and the account reports no negative balance
    When "lesson.completed" for "A" on lesson "L2" is recorded
    Then 10 Pul settle the obligation first and 20 Pul remain to be earned back

  @EARS-15
  @points-advance-boundaries
  Scenario: A doctor who arrived on a medical representative's link gets the same conditions
    Given doctor "B" arrived on a medical representative's personal link and has 20 Pul
    When "B" registers for the advance-mode event "E2" priced 50 Pul
    Then "B" receives the same reserve and advance postings as "A"
    And the postings carry the attribution of the medical representative only

  @EARS-13 @EARS-16 @EARS-17 @failure
  @points-advance-boundaries
  Scenario: Beyond the advance cap the event behaves as threshold
    Given "A" has 150 Pul of open obligations and 0 Pul available
    When "A" asks to reserve for another advance-mode event priced 50 Pul
    Then the reserve is refused with problem "points-threshold-short" and a shortfall of 50
    And the earn hint states 200 Pul to earn and 20 lessons, the 150 Pul owed counted first
    And an open event and every lesson remain open to "A"

  @EARS-18 @failure
  @points-lifecycle-boundaries
  Scenario: A no-show releases the reserve and annuls the advance
    Given "A" holds a reserve with an advance on event "E2"
    When "E2" ends and the 24-hour no-show window passes without "attendance.confirmed" for "A"
    Then the no-show sweep records "registration.no-show" and the hold is released by compensating postings
    And the advance and its obligation are annulled
    And no participation award is posted
    When "attendance.confirmed" for "A" on "E2" arrives late
    Then nothing is settled, the trace reads "no-open-hold" and the participation award is posted as late

  @EARS-18 @EARS-20 @EARS-35 @failure
  Scenario: Releasing a partly netted obligation returns the netted Pul
    Given "A" holds a reserve on advance-mode event "E4" with an obligation "O1" of 30 Pul
    And an older obligation "O0" of 20 Pul is open for "A"
    And later lessons netted 20 Pul to "O0" and 10 Pul to "O1"
    When "A" cancels the registration on "E4"
    Then the advance of "O1" and its own 10 Pul netting leg are reversed
    And "O1" reports a remaining debt of 0 and "O0" stays netted with 0 Pul remaining
    And "A" has the Pul available as if the registration on "E4" had never been made

  @EARS-21 @failure
  @points-reserve-boundaries
  Scenario: A fourth concurrent limited-seat reserve is refused
    Given "A" holds 3 open reserves on limited-seat events
    When "A" asks to reserve a seat on a fourth limited-seat event
    Then the reserve is refused with problem "points-reserve-limit" and no posting is written

  @EARS-23 @EARS-24
  Scenario: The monthly leaderboard ranks consenting doctors only
    Given doctors "A" and "C" of "Кардиология" hold an active leaderboard-dissemination consent
    And doctor "D" of "Кардиология" earned more Bre this month but holds no such consent
    When the November leaderboard of "Кардиология" is requested
    Then it ranks "A" and "C" by 2·Con + Bre earned in November
    And "D" appears in no row and shifts no rank number
    When "C" revokes the consent
    Then the next leaderboard response contains no row for "C"

  @EARS-25 @EARS-27 @EARS-42
  Scenario: Re-tuning a rule applies to new postings only
    Given "A" received a lesson award under rule "accrual.lesson" version 2
    When an admin publishes "accrual.lesson" version 3 with 15 Pul
    And "lesson.completed" for "A" on lesson "L3" is recorded
    Then the new posting carries version 3 and 15 Pul
    And the earlier posting still carries version 2 and 10 Pul and its fact is not re-evaluated

  @EARS-25 @EARS-32 @happy
  @points-rulebook-boundaries
  Scenario: An admin attaches a new reward to an existing fact type without a release
    When an admin publishes the new rule "accrual.webinar-feedback" crediting 2 Bre on "event.rated" once per subject and ref
    And "event.rated" for "A" on event "E5" is recorded
    Then postings of rule "accrual.webinar-feedback" version 1 and of rule "accrual.rating" are both written

  @EARS-25 @EARS-34 @failure
  @points-rulebook-boundaries
  Scenario: A rule reading an undeclared or ill-typed operand is refused at publish
    When an admin publishes a rule on "lesson.completed" whose condition reads the attribute "sponsorId"
    Then the request is refused with problem "points-rule-parameters-invalid" naming the field path
    When an admin publishes a rule on "lesson.completed" comparing the attribute "mode" with the integer 3
    Then the request is refused with problem "points-rule-parameters-invalid" naming the field path
    When an admin publishes a new version of the retired rule "cap.engagement"
    Then the request is refused with problem "points-rule-retired"

  @EARS-32 @failure
  Scenario: The catalog refuses an attribute that names a sponsor
    Given a developer registers a fact type with an attribute "sponsorOrganisationId"
    When the catalog unit test and the lint run
    Then both fail naming the forbidden attribute

  @EARS-33 @failure
  @points-engine-originals
  Scenario: A producer fact carrying an amount is refused and writes nothing
    When a producer records "lesson.completed" for "A" with an attribute "pul" of 100
    Then the call throws and no journal row and no posting are written

  @EARS-33 @EARS-40
  @points-engine-originals
  Scenario: A fact no rule applies to is journaled with no effect
    When "referral.attributed" for "A" is recorded
    Then the outcome is "no-effect" and no posting is written
    And the journal row holds the fact and its evaluation trace

  @EARS-36 @EARS-37 @EARS-38
  @points-lifecycle-boundaries
  Scenario: Exclusive campaign rules apply only the highest priority one inside their window
    Given rules "campaign.lesson.double" of priority 10 and "campaign.lesson.bonus" of priority 5 share an exclusive group on "lesson.completed"
    And "campaign.lesson.double" is valid only during November
    When "lesson.completed" for "A" on lesson "L6" is recorded in November
    Then "campaign.lesson.double" applies and "campaign.lesson.bonus" is traced "superseded"
    When "lesson.completed" for "A" on lesson "L7" is recorded in December
    Then "campaign.lesson.double" is traced "not-valid" and "campaign.lesson.bonus" applies

  @EARS-38
  @points-rulebook-boundaries
  Scenario: Publishing a second stacking credit rule warns the admin
    When an admin publishes an active credit rule on "lesson.completed" with no exclusive group
    Then the version is stored and the answer carries a stacking warning naming "accrual.lesson"

  @EARS-39 @failure
  Scenario: A setting changes a threshold without a rule version
    When an admin publishes "setting.presence.share" version 2 with 50
    And "attendance.confirmed" for "A" on event "E6" is recorded with a presence share of 45 %
    Then no participation award is posted and the trace reads "condition-false"

  @EARS-41 @EARS-13
  @points-reserve-boundaries
  Scenario: A quote equals the enforced decision and writes nothing
    Given "A" has 20 Pul available and a threshold-mode event "E7" priced 50 Pul
    When the gating decision of "E7" is requested for "A"
    Then it is "short" with a shortfall of 30 and no row is written to the journal or the ledger
    When "A" registers for "E7"
    Then the registration is refused with problem "points-threshold-short" and the same shortfall of 30

  @EARS-43 @happy
  @points-lifecycle-boundaries
  Scenario: Doctors registered before the engine receive the starter bonus once
    Given doctors "F" and "G" registered before the engine and "F" never received the registration grant
    And "G" already received the registration grant
    When an admin runs the starter-bonus grant with a reason and an instant after both registrations
    Then "F" receives 20 Pul under rule "accrual.starter-bonus" and "G" receives nothing
    And audit records name the admin, the reason, the instant and the counts
    When the admin runs the grant again
    Then every doctor answers "duplicate" and no posting is written

  @EARS-43 @failure
  Scenario: The starter-bonus grant needs an active rule
    Given "accrual.starter-bonus" is deactivated
    When an admin runs the starter-bonus grant
    Then the run is refused with problem "points-starter-bonus-no-rule" and no fact is recorded

  @EARS-44 @failure
  Scenario: The engine migration refuses a ledger that already holds postings
    Given a database at migration 0059 holding one posting
    When the engine migration runs
    Then it raises and applies nothing, and every 0059 row is unchanged

  @EARS-45 @failure
  Scenario: Only an admin reads the catalog, the rules and the journal
    When an admin requests the fact types, the rules and the facts of "A"
    Then the catalog, each rule with its version history and the journal rows with their traces are returned
    When doctor "A" requests the facts of "A" on the admin route with a portal session
    Then the request is refused with 401
    When a staff member without the admin role requests the facts of "A" on the admin route
    Then the request is refused with 403

  @EARS-46 @EARS-30
  Scenario: A doctor reads only their own posting history
    Given "A" and doctor "H" both have postings
    When "A" requests the posting history
    Then only the postings of "A" are returned newest first with signed amounts and a next cursor
    And no attribution field and no identifier of "H" appears

  @EARS-28 @EARS-27 @failure
  Scenario: A wrong accrual is corrected by a compensating posting
    Given a posting "P" credited 10 Pul to "A" in error
    When an admin posts a reversal of "P" with a reason
    Then a compensating posting referencing "P" is written and an audit record names the admin and the reason
    And an UPDATE or DELETE of "P" is refused by the database
    And a second reversal of "P" is refused

  @EARS-26 @failure
  Scenario: A lesson and an НМО-accredited event cannot be priced
    When an admin sets lesson "L1" to threshold mode
    Then the request is refused with problem "points-gating-invalid"
    When an admin sets an НМО-accredited event to advance mode
    Then the request is refused with problem "points-gating-invalid"

  @EARS-26 @EARS-35 @happy
  Scenario: A course is priced in Pul and its access debits the price
    Given an admin sets course "K1" to threshold mode priced 100 Pul
    And "A" has 120 Pul available
    When "item.access-requested" for "A" on "K1" is recorded
    Then 100 Pul are debited under rule "spend.debit" and "A" has 20 Pul available

  @EARS-5 @EARS-35 @failure
  Scenario: Pul of a doctor without a verified phone cannot be spent
    Given doctor "J" has 30 Pul and no verified phone
    When "J" registers for a threshold-mode event priced 20 Pul
    Then the registration is refused with problem "points-phone-unverified" and nothing is written

  @EARS-29
  Scenario: Attention aggregates carry no person identifier
    Given postings of several doctors on project "P1"
    When the aggregates of "P1" for November are requested with the service scope
    Then sums per denomination and rule version with a count of persons are returned
    And no person identifier appears in the response

  @EARS-31 @failure
  @points-record-boundaries
  Scenario: A closed account accepts no posting
    Given the account of "A" is closed for erasure
    When "lesson.completed" for "A" is recorded
    Then it is refused with problem "points-account-closed"
    And every existing posting of "A" is unchanged

  @EARS-10 @EARS-12
  Scenario: Engagement is capped per event and nothing is ever taken away
    Given "A" attends event "E3"
    When "A" asks the speaker two questions during "E3"
    Then exactly one engagement award of 1 Bre is posted for questions on "E3"
    When "A" fails the test of lesson "L4" twice
    Then no posting debits Pul, Bre or Con from "A"

  @EARS-22 @failure
  @points-reserve-boundaries
  Scenario: Concurrent reserves never overdraw the balance
    Given "A" has 50 Pul available
    When "A" registers for two threshold-mode events priced 50 Pul at the same instant
    Then exactly one reserve is posted and the other is refused with problem "points-threshold-short"
    And "A" never has less than 0 Pul available

  @EARS-30
  @points-referral-boundaries
  Scenario: Pul amounts never read as money
    When the gating decision of an open event is requested for "A"
    Then the response carries a pulCost of 0 in Pul and no field stating that the event is free

  @EARS-8
  @points-record-boundaries
  Scenario: A completed module accrues all three units once
    When "module.completed" for "A" on module "M1" is recorded twice
    Then exactly one module award of 20 Pul, 3 Bre and 1 Con is posted for "A" on "M1"

  @EARS-11 @EARS-36
  @points-referral-boundaries
  Scenario: Referral awards stop for the inviter above the monthly cap
    Given "A" has received 5 referral awards this calendar month
    When a sixth invitee of "A" verifies the phone and completes a first lesson
    Then the invitee receives 30 Pul
    And no referral award is posted to "A" for that invitee and the inviter rule is traced "limit-reached"

  @EARS-11 @EARS-34
  @points-referral-boundaries
  Scenario: The invitee's first completed lesson counts itself for the referral
    Given invitee "F" of "A" has a verified phone and no completed lesson
    When "lesson.completed" for "F" on lesson "L8" is recorded
    Then "person.completedLessons" reads 1 for that evaluation
    And "F" receives 30 Pul under "accrual.referral-invitee" on that same fact

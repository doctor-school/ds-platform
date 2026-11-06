# 025 — Attention points engine — scenarios
# Tags map every scenario to the flat EARS clauses in 025-requirements-en.md.
# This is a backend-only spec: each scenario is executed by the Vitest e2e named
# in the requirements' Verification table against the real apps/api -> Postgres
# stack. Facts come from their producer features (021, 022, 024, 020, the room);
# amounts in brackets are rule-version parameters with the PRD defaults.

Feature: One attention-points ledger accrues, reserves, debits and releases Pul, Bre and Con

  Background:
    Given the rule book holds version 1 of every rule with the PRD defaults
    And a doctor "A" of specialty "Кардиология" with a verified phone

  @EARS-1 @EARS-2 @EARS-3 @EARS-5 @EARS-6 @EARS-14 @EARS-19 @EARS-9 @happy
  Scenario: Registration to the first event
    Given doctor "A" has no points account
    When the facts DoctorRegistered and PhoneVerified for "A" are accepted
    Then exactly one attention-points account exists for "A"
    And "A" has 20 Pul available, each posting carrying rule "accrual.registration" version 1
    When the fact ProfileVerified for "A" is accepted
    Then "A" has 50 Pul available and 2 Bre
    When "A" registers for a threshold-mode event "E" priced 50 Pul
    Then a reserve of 50 Pul is posted and "A" has 0 Pul available and 50 Pul reserved
    When AttendanceConfirmed arrives for "A" on "E" with a presence share of 45 %
    Then the reserve is debited once
    And "A" has 0 Pul, 4 Bre and 1 Con

  @EARS-4 @EARS-7
  Scenario: The same lesson reported from two storefronts and an offline sync accrues once
    When LessonCompleted for "A" on lesson "L1" arrives from the doctor storefront
    And LessonCompleted for "A" on lesson "L1" arrives from the Academy with another event id
    And the mobile offline sync replays LessonCompleted for "A" on lesson "L1"
    Then exactly one lesson award of 10 Pul and 1 Bre is posted for "A" on "L1"
    And the second and third answers are "duplicate"

  @EARS-15 @EARS-20
  Scenario: Advance covers the shortfall and later earnings settle it
    Given "A" has 20 Pul available
    And an advance-mode event "E2" priced 50 Pul
    When "A" registers for "E2"
    Then 20 Pul are reserved from the balance and 30 Pul are covered by an advance
    And "A" has an open obligation of 30 Pul and the account reports no negative balance
    When LessonCompleted for "A" on lesson "L2" is accepted
    Then 10 Pul settle the obligation first and 20 Pul remain to be earned back

  @EARS-15
  Scenario: A doctor who arrived on a medical representative's link gets the same conditions
    Given doctor "B" arrived on a medical representative's personal link and has 20 Pul
    When "B" registers for the advance-mode event "E2" priced 50 Pul
    Then "B" receives the same reserve and advance postings as "A"
    And the postings carry the attribution of the medical representative only

  @EARS-13 @EARS-16 @EARS-17 @failure
  Scenario: Beyond the advance cap the event behaves as threshold
    Given "A" has 150 Pul of open obligations and 0 Pul available
    When "A" asks to reserve for another advance-mode event priced 50 Pul
    Then the reserve is refused with problem "points-threshold-short" and a shortfall of 50
    And the earn hint names 5 lessons
    And an open event and every lesson remain open to "A"

  @EARS-18 @failure
  Scenario: A no-show releases the reserve and annuls the advance
    Given "A" holds a reserve with an advance on event "E2"
    When "E2" ends and the settlement window passes without AttendanceConfirmed for "A"
    Then the reserve is released by compensating postings
    And the advance and its obligation are annulled
    And no participation award is posted

  @EARS-21 @failure
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

  @EARS-25 @EARS-27
  Scenario: Re-tuning a rule applies to new postings only
    Given "A" received a lesson award under rule "accrual.lesson" version 1
    When an admin publishes "accrual.lesson" version 2 with 15 Pul
    And LessonCompleted for "A" on lesson "L3" is accepted
    Then the new posting carries version 2 and 15 Pul
    And the earlier posting still carries version 1 and 10 Pul

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

  @EARS-29
  Scenario: Attention aggregates carry no person identifier
    Given postings of several doctors on project "P1"
    When the aggregates of "P1" for November are requested with the service scope
    Then sums per denomination and rule version with a count of persons are returned
    And no person identifier appears in the response

  @EARS-31 @failure
  Scenario: A closed account accepts no posting
    Given the account of "A" is closed for erasure
    When LessonCompleted for "A" is accepted
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
  Scenario: Concurrent reserves never overdraw the balance
    Given "A" has 50 Pul available
    When "A" registers for two threshold-mode events priced 50 Pul at the same instant
    Then exactly one reserve is posted and the other is refused with problem "points-threshold-short"
    And "A" never has less than 0 Pul available

  @EARS-30
  Scenario: Pul amounts never read as money
    When the gating decision of an open event is requested for "A"
    Then the response carries a pulCost of 0 in Pul and no field stating that the event is free

  @EARS-8
  Scenario: A completed module accrues all three units once
    When ModuleCompleted for "A" on module "M1" is accepted twice
    Then exactly one module award of 20 Pul, 3 Bre and 1 Con is posted for "A" on "M1"

  @EARS-11
  Scenario: Referral awards stop for the inviter above the monthly cap
    Given "A" has received 5 referral awards this calendar month
    When a sixth invitee of "A" verifies the phone and completes a first lesson
    Then the invitee receives 30 Pul
    And no referral award is posted to "A" for that invitee

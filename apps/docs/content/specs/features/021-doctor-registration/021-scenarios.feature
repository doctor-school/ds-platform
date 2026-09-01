# 021 — Doctor registration & consents — scenarios
# Tags map every scenario to the flat EARS clauses in 021-requirements-en.md.
# This is a user-facing spec: the journeys run through Playwright BDD against the
# real apps/doctor -> NestJS -> Zitadel -> Postgres stack. Credentials, codes and
# sessions come from feature 003, never from a seeded stand-in; consent storage is
# feature 037's and the points ledger is feature 025's.
# Stage-A picks in force: F-021-1 = Б (two-tier consents), F-021-2 = Б (return
# context in the split's left half, WITHOUT a back-navigation control), F-021-3 =
# points promised on the form (+20 Pul registration / +30 Pul profile completion) —
# deferred to wave 2 by the А1 release-1 cut (#1703, tracked by #1545), so the
# @EARS-9 scenarios below are wave-2 acceptance and release 1 promises no points.

Feature: A doctor stopped by a gate registers in a short honest form and comes back to what they came for

  Background:
    Given feature 017's storefront shell is in place
    And feature 020's event page is in place
    And feature 003's authentication engine is running
    And an эфир «Артроскопия коленного сустава» exists with a public event page

  @EARS-1 @EARS-2 @EARS-4 @EARS-5 @EARS-7 @EARS-10 @happy
  Scenario: A doctor registers from a gate and returns to the эфир
    Given a guest doctor pressed «Участвовать» on «Артроскопия коленного сустава»
    When the registration screen opens
    Then it renders the auth canvas split composition with no storefront header, navigation or footer
    And exactly one wordmark renders for the viewport — pinned to the top of the brand panel on the wide layout, above the card on the narrow one where the panel does not render
    And the card stands centred on the vertical axis of the form column
    And the left half shows the эфир through the canonical event-card unit feature 004 owns and feature 019 widens
    And that card carries no back-navigation control
    And the form asks only for email, password and an optional promo code
    And no file input, document field or document copy exists anywhere on the screen
    And the form makes no points promise and renders no placeholder in its place
    And the medical-worker declaration and the partner-data consent are framed together above the submit button
    And the partner-data consent names имя, специальность, город, место работы and states that contact details are not shared
    And the marketing opt-in stands separately below the submit button and is not pre-ticked
    When the doctor fills a valid email and an eight-character password
    And ticks both access-condition consents
    And submits the form
    Then the screen states that a letter was sent
    And one versioned dated consent record exists for medical-worker-declaration
    And one versioned dated consent record exists for partner-data-sharing
    And no consent record exists for marketing-communications
    When the doctor confirms the email with the code from the letter
    Then the success state states no points amount, promised or credited
    And the primary action returns to «Артроскопия коленного сустава»
    And «в личный кабинет» is offered only as a secondary action

  @EARS-9 @happy
  Scenario: Wave 2 — the form promises the registration points and the success state credits them
    Given the wave-2 points surface of #1545 is in place
    And a guest doctor opened the registration screen from «Артроскопия коленного сустава»
    Then the form promises «+20 Pul за регистрацию»
    When the doctor registers and confirms the email with the code from the letter
    And feature 025 emits PointsCredited for that account
    Then the success state states the credited «+20 Pul» as the amount carried by that event
    And it names «+30 Pul» for completing the profile and what completing it unlocks

  @EARS-9 @failure
  Scenario: With no ledger event the success state promises rather than claims a credit
    Given the wave-2 points surface of #1545 is in place
    And feature 025 has emitted no PointsCredited for the account
    When a doctor confirms their email and reaches the success state
    Then the success state names the accrual as a pending promise
    And no credited amount is stated as a fact
    And no credited amount is derived from the points configuration

  @EARS-19 @failure
  Scenario: Every public form carries the bot-protection challenge of 003 EARS-17
    Given the registration screen is open on «doctor.school»
    Then the bot-protection challenge of the 003 EARS-17 contract is rendered on the form
    When the doctor submits the form
    Then the command carries the challenge token
    When the doctor requests a verification-code resend
    Then that request carries the challenge token too
    When a submission is replayed without the token
    Then the 003 contract rejects it unchanged
    And no storefront-local challenge logic, provider or threshold exists in apps/doctor
    When the challenge fails to load
    Then the failure is stated in Russian with a working retry

  @EARS-3 @EARS-6 @happy
  Scenario: A doctor arriving directly registers without the marketing opt-in and lands on their feed
    Given a guest doctor opens the registration route with no return target
    Then the return-context element is absent from the DOM rather than rendered empty
    When the doctor completes the form with both access-condition consents and leaves the marketing opt-in unticked
    And confirms the email
    Then registration completes
    And the doctor lands on the 019 events feed rather than the account page
    And no consent record exists for marketing-communications

  @EARS-8 @EARS-17 @happy
  Scenario: A doctor arriving on a representative's link is attributed and handed to the mailing base
    Given a guest doctor follows a medical representative's personal link to the registration screen
    Then the screen names who brought them in plain words
    And no rendered string states who pays for the doctor's education
    And «партнёр» is not used as the money-carrier in any rendered string
    When the doctor also types a promo code belonging to another campaign
    And completes registration with the marketing opt-in ticked
    Then the account carries the representative's attribution and not the typed code's
    And a marketing consent record is emitted with the doctor's segmentation attributes
    And feature 021 exposes no mailing transport, list membership or unsubscribe surface

  @EARS-13 @failure
  Scenario: An already-registered email is never disclosed as already registered
    Given an account already exists for «doctor@example.test»
    When a visitor submits the registration form with that email
    Then the response body, status and timing are indistinguishable from a new registration
    And the screen shows the existence-agnostic «письмо отправлено» state
    And code entry, «Войти» and «Восстановить пароль» are offered as co-equal actions
    And no string anywhere states that the email is already taken

  @EARS-12 @EARS-11 @failure
  Scenario: A missing consent disables the button with its reason, and errors say what to do
    Given a guest doctor on the registration screen
    When the doctor enters «not-an-email» in the email field
    Then the email field states what to correct, in Russian, tied to that field
    When the doctor enters a five-character password
    Then the persistent hint «Не менее 8 символов» stays visible alongside the error
    When the doctor leaves the medical-worker declaration unticked
    Then the submit control is disabled
    And the reason naming that specific unticked condition is rendered beside it
    And no state of this screen has a disabled button without a stated reason

  @EARS-14 @failure
  Scenario: A failed submission preserves everything the doctor typed
    Given a guest doctor filled the form completely on a representative's link
    When the submission fails on the network
    Then the failure is stated in Russian with a working retry
    And every field value, every checkbox state and the resolved attribution survive
    And the retry submits without re-filling anything
    And the password appears in no URL, storage entry or cookie

  @EARS-10 @failure
  Scenario: A stale return target degrades honestly instead of dead-ending
    Given a doctor registered from an эфир and confirms the letter after the эфир was unpublished
    When the confirmation link is opened
    Then the doctor lands on the nearest honest destination
    And a plain Russian line states what happened to the content they came for
    And no dead link and no silent redirect occurs

  @EARS-15 @EARS-16 @happy
  Scenario: One account, one sign-up, operable at both breakpoints
    Given a doctor registered on «doctor.school»
    Then no account-type control («врач / эксперт») exists on the registration screen
    And no separate Academy sign-up is offered or linked
    And the same account authenticates on the Academy host without registering again
    When every screen state is rendered at 390 and at 1440 in both themes
    Then each state is fully operable
    And the route passes the playwright-axe gate
    And every checkbox is a real labelled control
    And the disabled-submit reason is readable by a screen reader
    And the two consent tiers are distinguishable to assistive technology

  @EARS-11 @failure
  Scenario: The verification code field does not fight the code that was actually sent
    Given a doctor on a mobile viewport reached the «письмо отправлено» state
    Then the verification-code field admits letters as well as digits
    And no CSS uppercase transform is applied to the field
    When the doctor types the issued code exactly as it arrived, in lower case
    Then verification succeeds

  @EARS-7 @failure
  Scenario: The interface offers no self-service consent withdrawal
    Given a doctor completed registration
    When any state of the registration surface is scanned
    Then no withdrawal toggle or «отозвать согласие» control exists
    And the interface states that a change or withdrawal is a request handled by a platform manager

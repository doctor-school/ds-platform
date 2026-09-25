@feature:044 @track:platform
Feature: 044 — Congress sign-up
  As a congress participant, an event registrar and the platform
  I want a sign-up on the congress site to become a Doctor.School account and a registration
  So that nobody registers twice, nothing leaks who already has an account, and the organizing team can work the roster

  Background:
    Given the congress event is published with participationFormat "offline"
    And the congress site proxies "/api" to the platform API same-origin
    And the site's nginx egress address is listed in TRUSTED_PROXIES
    And the intake endpoint is public, carries the bot-protection decorator and is rate limited at 60 submissions per 15 minutes per client address
    And the current time is inside the congress registration window
    And the personal-data consent page is published, its version being its publication date plus the sha256 of its text

  @EARS-1 @EARS-3 @EARS-4 @EARS-5 @EARS-9 @EARS-10 @EARS-11 @EARS-13
  Scenario: Happy path — a new email becomes an account and a registration
    Given no Doctor.School account exists for "new@example.org"
    When a participant submits the sign-up form with surname, first name, contact phone, "new@example.org", a specialty chosen from the taxonomy, workplace, city, region, no patronymic, a ticked personal-data consent and a valid captcha token
    Then exactly one account is created for "new@example.org" with no credential in the identity provider
    And that account's display name is prefilled from the submitted surname and first name
    And exactly one registration row exists for that account and the congress event
    And the submitted answers are stored on that registration row
    And the submitted contact phone is not written into the account's phone column
    And exactly one consent record is written under the congress personal-data purpose with the server-stamped version
    And no medical-worker-declaration consent record is written
    And the participant receives the generic success response, which confirms the registration was accepted, states that a confirmation email has been sent to the address given, and states that nothing further is required
    # Production amendment 2026-09-24 (#2369, 044-requirements «Production amendment — confirmation email copy»): the line below is the running-production baseline; the amended email names the event, its date and venue
    # as ONE copy for every participant, with no account paragraph and no sign-in action (EARS-13.1 / EARS-13.2).
    And a confirmation email is dispatched naming the event, the created Doctor.School account and code-based sign-in
    And the registration's confirmation-mail outcome is recorded as sent with its timestamp

  @EARS-14
  Scenario: First platform entry proves the address
    Given a congress-origin account exists for "new@example.org" with email_verified false
    When its holder requests a one-time login code by email
    Then no login code is issued and the verification code is re-issued instead
    When they complete the existing email verification-code path
    Then email_verified becomes true
    And a subsequent email one-time-code login succeeds
    And no credential was ever set on that account

  @EARS-6 @EARS-7
  Scenario: An email the platform already knows is attached, not rewritten and not disclosed
    Given an account exists for "known@example.org" with its own display name, phone and profile values
    When a participant submits the sign-up form with "known@example.org" and different name, phone, workplace, city and region values
    Then the registration is attached to the existing account
    And every profile field of that account is unchanged
    And the submitted answers are stored only on the registration row
    And the response body, status code and timing class are identical to the new-account response
    And that response body is exactly the single accepted state the congress site renders its confirmation from

  @EARS-8 @EARS-12
  Scenario: A repeat submission is an idempotent no-op behind the same success response
    Given "known@example.org" is already registered for the congress event
    And that registration's confirmation-mail outcome is sent
    When the same form is submitted again with the same email
    Then the same generic success response is returned
    And no second account is created
    And no second registration row exists for that account and event
    And no second confirmation email is dispatched

  @EARS-11 @EARS-12
  Scenario: Failure branch — the confirmation email fails to send
    Given the mailer rejects every send attempt after its failover chain
    When a participant submits the sign-up form with a new email
    Then the account, the registration and the consent record are committed
    And the participant still receives the generic success response
    And the registration's confirmation-mail outcome is recorded as failed with its timestamp
    And no retry is scheduled
    When the same participant submits the same form again
    Then no duplicate registration is created
    And the confirmation email is dispatched again

  @EARS-28
  Scenario: Failure branch — the submission arrives before registration opens
    Given the current time is before the registration opening instant
    When a participant submits the sign-up form
    Then the submission is refused with a machine-readable not-yet-open state carrying the opening instant
    And no account, registration or consent record is created
    And no email is dispatched
    And the refusal is the same for an email that already has an account and one that does not

  @EARS-28
  Scenario: Failure branch — the submission arrives after registration closes
    Given the current time is after the registration closing instant
    When a participant submits the sign-up form
    Then the submission is refused with a machine-readable closed state
    And no account, registration or consent record is created
    And no email is dispatched

  @EARS-8
  Scenario: The published consent version changed since the recorded acceptance
    Given "known@example.org" is already registered for the congress event
    And the published personal-data consent version differs from the one recorded for that registration
    When the same form is submitted again with the same email
    Then the same generic success response is returned
    And no second registration row exists for that account and event
    And exactly one further consent record is written, carrying the newly published version

  @EARS-29 @EARS-30
  Scenario: Two registrations sharing a phone are accepted and marked
    Given a participant has registered with the contact phone "+7 (999) 123-45-67"
    When another participant submits the sign-up form for the same event with a different email and the contact phone "8 999 1234567"
    Then both submissions receive the identical generic success response
    And both phones are stored on their registrations as typed and in the same normalised form
    And neither phone is written into any account's phone column
    And both registrations are marked "возможный дубль" in the roster read model
    When one of those two registrations is removed at the team's manual request
    Then the remaining registration is no longer marked "возможный дубль"

  @EARS-33
  Scenario: The name answers are cleaned up before anything stores them
    Given no Doctor.School account exists for "names@example.org"
    When a participant submits the sign-up form for "names@example.org" with the surname "  иванова ", the first name "мАРИЯ", the patronymic "  сергеевна" and the workplace "НМИЦ им. В. А. Алмазова"
    Then the registration's answers hold the surname "Иванова", the first name "Мария" and the patronymic "Сергеевна"
    And the account's display name is "Иванова Мария"
    And the workplace is stored exactly as the participant typed it

  @EARS-30
  Scenario: A registration with no answers payload is never marked
    Given a signed-in doctor has registered for the congress event from the platform feed
    When the registrar opens the roster
    Then that registration carries no contact phone and is not marked "возможный дубль"

  @EARS-31 @EARS-32
  Scenario: The registrar filters the duplicates and prints them
    Given a principal holds the event-registrar role
    And the roster holds registrations of which some share a normalised contact phone
    When they open the roster
    Then the rows sharing a phone show the "возможный дубль" indicator, in the unchanged column order
    When they apply the "возможный дубль" filter together with a text-column filter and a sort
    Then the server returns only the marked rows matching that filter, sorted as requested
    # Production amendment 2026-09-25 (#2377): the print steps below are the running-production baseline and are cancelled (EARS-32 not implemented).
    When they print from that view
    Then the printed sheet contains exactly those rows and shows the "возможный дубль" marker on them

  @EARS-1
  Scenario: Failure branch — the captcha challenge is not satisfied
    Given the submitted captcha token is missing or invalid
    When a participant submits the sign-up form
    Then the submission is refused with a generic failure that discloses no reason
    And no account, registration or consent record is created
    And no email is dispatched

  @EARS-2
  Scenario: Failure branch — throttling keys on the participant, not the proxy
    Given several participants submit from different client addresses through the same site proxy
    When one of them exceeds the per-address submission window
    Then only that participant's further submissions are throttled
    And the other participants' submissions are accepted

  @EARS-3 @EARS-15
  Scenario: Specialty is chosen, never typed
    Given the public specialties list is served unauthenticated through the same proxy
    When the form offers the list for search and selection
    Then the list contains the platform's medical specialties and the explicit "Другое / не медицинский работник" option
    When a submission carries a specialty value that is not a taxonomy identifier or that option
    Then the submission is rejected by schema validation

  @EARS-16
  Scenario: A signed-in doctor registers from the platform feed
    Given a doctor is signed in to the platform
    When they register for the congress event from the platform's own event feed
    Then the registration lands in the same roster as a form-origin registration
    And that registration carries no answers payload
    And the roster renders its cells from the doctor's own profile, leaving a cell empty where the profile has no value

  # Production amendment 2026-09-25 (#2377): for event-registrar the navigation shows only the bound event's roster and create/edit/delete narrows to the two desk
  # mutations — see «Failure branch — the registrar is bound to one event» and «The registrar marks attendance per congress day» (EARS-24, EARS-38).
  @EARS-17 @EARS-19 @EARS-20 @EARS-24
  Scenario: Failure branch — the registrar is refused everywhere else
    Given a principal holds only the event-registrar role
    When they sign in to the admin app
    Then the navigation shows the congress roster entry and no other section link
    When they request any other admin section or API endpoint
    Then the server refuses the request
    And no create, edit or delete affordance for a registration is rendered anywhere

  @EARS-18 @EARS-21 @EARS-22 @EARS-23 @EARS-25 @EARS-26 @EARS-27
  Scenario: Registrar works the roster and prints the filtered sheet
    Given a principal holds the event-registrar role
    And the congress roster holds registrations from both the form and the platform feed
    When they open the roster
    # Production amendment 2026-09-25 (#2377): the column order on the next line is the baseline; EARS-37 replaces it — see «The registrar reads the reduced roster and opens a card».
    Then the roster lists registrations with pagination and instant search, in the column order №, ФИО, специальность, место работы, город, область, телефон, email, дата регистрации, статус письма
    When they filter a text column by contains-search, специальность by a select and дата регистрации by a range
    And they sort by ФИО and then by дата регистрации, in both directions
    Then the server returns the filtered, sorted page
    # Production amendment 2026-09-25 (#2377, 044-requirements «Production amendment — congress registration desk»): the print steps below are the running-production
    # baseline and are cancelled (EARS-26/27 not implemented); the roster columns are now №, ФИО, специальность, город, телефон, дата регистрации, присутствие (EARS-37).
    When they print from that view
    Then the printable sheet contains exactly the rows of the roster as currently searched, filtered and sorted, every roster column except статус письма, with no signature column and a header carrying the event's name and date
    And the printable sheet is rendered from design-system primitives with tokens-only styling
    And no file is exported

  # Production amendment 2026-09-25 (#2377, 044-requirements «Production amendment — congress registration desk»): the registration desk scenarios.

  @EARS-34
  Scenario: The registrar marks attendance per congress day
    Given a principal holds the event-registrar role bound to the congress event
    And the congress days are 2027-04-23 and 2027-04-24
    And a participant is registered for the congress event
    When the registrar marks the participant present for 2027-04-23
    Then the registration carries attendance present for 2027-04-23 and not marked for 2027-04-24
    And the change audit records the registrar as the actor and the time of the mark
    When the registrar filters the roster by attendance present on 2027-04-23
    Then the participant is in the result
    When the registrar clears the mark for 2027-04-23
    Then the change audit records that change with its actor and time too
    When the registrar tries to mark the participant for a day that is not a congress day
    Then the mark is refused

  @EARS-35
  Scenario: The registrar enters a walk-in participant at the desk
    Given a principal holds the event-registrar role bound to the congress event
    And the public registration window is closed
    And no Doctor.School account exists for "walkin@example.org"
    When the registrar enters surname, first name, contact phone, "walkin@example.org", a specialty, workplace, city and region and ticks that personal-data consent was obtained on paper
    Then exactly one account is created for "walkin@example.org" with no credential
    And exactly one registration exists for that account and the congress event, with origin "desk"
    And exactly one consent record is written under the congress personal-data purpose with the server-stamped version and origin "paper"
    And the same confirmation email as the site form is dispatched and its outcome is recorded
    When the registrar enters "walkin@example.org" again
    Then no second account or registration is created
    And the desk names the existing registration so the registrar can open its card

  @EARS-35
  Scenario: Failure branch — the desk entry without paper consent is refused
    Given a principal holds the event-registrar role bound to the congress event
    When the registrar submits a desk entry without ticking the paper-consent box
    Then the entry is refused
    And no account, registration or consent record is created
    And no email is dispatched

  @EARS-36 @EARS-37
  Scenario: The registrar reads the reduced roster and opens a card
    Given a principal holds the event-registrar role bound to the congress event
    And the roster holds registrations from the site form, the desk and the platform feed
    When they open the roster
    Then the columns are №, ФИО, специальность, город, телефон, дата регистрации, присутствие in that order
    And workplace, region, email and mail status are offered as filters in the filter panel
    When they open a row
    Then the participant card shows every stored field, the registration date and origin, the consent with its version and origin, the confirmation-mail outcome, the "возможный дубль" marker and the attendance per day with who marked it and when
    And no field of the card can be edited and nothing can be deleted

  @EARS-38
  Scenario: Failure branch — the registrar is bound to one event
    Given a principal holds only the event-registrar role, bound to the congress event
    When they sign in to the admin app
    Then the navigation shows only the congress event's roster and no other section or event link
    When they request the roster, a card, an attendance mark or a desk entry of any other event, or the event list
    Then the server refuses the request
    Given another principal holds the event-registrar role with no event binding
    When they request any endpoint other than the session endpoints
    Then the server refuses the request

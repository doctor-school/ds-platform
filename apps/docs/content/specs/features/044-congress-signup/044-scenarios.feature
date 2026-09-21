@feature:044 @track:platform
Feature: 044 — Congress sign-up
  As a congress participant, an event registrar and the platform
  I want a sign-up on the congress site to become a Doctor.School account and a registration
  So that nobody registers twice, nothing leaks who already has an account, and the organizing team can work the roster

  Background:
    Given the congress event is published with participationFormat "offline"
    And the congress site proxies "/api" to the platform API same-origin
    And the site's nginx egress address is listed in TRUSTED_PROXIES
    And the intake endpoint is public, carries the bot-protection decorator and is rate limited
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
    And the participant receives the generic success response
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
  Scenario: Failure branch — existing email never rewrites the profile and never leaks
    Given an account exists for "known@example.org" with its own display name, phone and profile values
    When a participant submits the sign-up form with "known@example.org" and different name, phone, workplace, city and region values
    Then the registration is attached to the existing account
    And every profile field of that account is unchanged
    And the submitted answers are stored only on the registration row
    And the response body, status code and timing class are identical to the new-account response

  @EARS-8 @EARS-12
  Scenario: Failure branch — repeat submission is a no-op that looks like success
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
    Then the roster lists registrations with pagination and instant search
    When they filter by specialty, by city or region and by confirmation-mail outcome
    And they sort by surname and then by registration time
    Then the server returns the filtered, sorted page
    When they print from that view
    Then the printable sheet contains exactly the rows of the roster as currently searched, filtered and sorted
    And the printable sheet is rendered from design-system primitives with tokens-only styling in the owner-approved layout
    And no file is exported

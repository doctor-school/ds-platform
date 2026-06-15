# 003 — User authentication scenarios
# Gherkin for the net-new web auth vertical (doctor_guest over Zitadel).
# Happy paths + failure branches. Translated to Playwright via playwright-bdd
# once that runner exists (out of scope here; authored now to satisfy the SDD triplet).
# Tags map scenarios to EARS handlers in 003-requirements-en.md.

Feature: Net-new web authentication producing a doctor_guest identity

  Background:
    Given the Zitadel IdP is reachable and seeded with the doctor_guest role
    And the portal serves headless inline auth forms on its configured origin
    And the abuse guards (rate-limit, captcha, sms-budget) are active

  @EARS-1 @EARS-20 @EARS-19 @happy
  Scenario: Register with email and password
    Given a visitor with a never-registered email and a valid SmartCaptcha token
    When the visitor submits the registration form with email, a policy-conforming password, and accepted consent versions
    Then a Zitadel user is created
    And a doctor_guest UserMirror row is upserted with that zitadel_sub
    And the accepted per-purpose consent versions are recorded
    And an email verification code is sent
    And the response does not reveal whether the email pre-existed

  @EARS-20 @failure
  Scenario: Registration is refused without consent
    Given a visitor with a valid email, password, and SmartCaptcha token
    When the visitor submits the registration form without any accepted consent version
    Then no PD-bearing UserMirror row is committed
    And the response is a generic validation failure

  @EARS-1 @EARS-16 @failure
  Scenario: Registration with an already-registered email is enumeration-resistant
    Given an email that is already registered
    When a visitor submits the registration form with that email
    Then the response is indistinguishable in status, body, and timing from the never-registered case
    And no duplicate account is created

  @EARS-23 @EARS-16 @happy
  Scenario: Already-registered email receives an account-exists notice, not a verification code
    # The legitimate owner must never be stranded waiting for a code that, by
    # design, is never sent on this branch. The notice carries no code/token and
    # creates nothing; the API response is identical to the never-registered case.
    Given an email that is already registered
    When a visitor submits the registration form with that email
    Then an account-exists notice email (sign-in / reset prompt, no code or token) is sent to that address
    And no verification code is sent and no account, consent, or audit_ledger row is written
    And the API response is indistinguishable in status, body, and timing from the never-registered case

  @EARS-23 @failure
  Scenario: Repeated duplicate registrations do not flood the inbox
    Given an email that is already registered
    And an account-exists notice was just sent to that address
    When a visitor submits the registration form with that email again within the throttle window
    Then no second account-exists notice is sent
    And the API response is still indistinguishable from the never-registered case

  @EARS-24 @EARS-16 @happy
  Scenario: The post-registration screen serves both new and existing visitors without revealing which
    Given a visitor has submitted the registration form
    When the portal shows the post-registration screen
    Then the screen frames the step as "check your email"
    And it offers entering the email code as a co-equal affordance
    And it offers prominent Sign in and Reset password actions
    And the screen never branches on whether the email was already registered

  @EARS-2 @EARS-16 @failure
  Scenario: Phone-only registration is not offered and never 500s
    # Zitadel cannot create a login-capable human without an email (GH #202);
    # email is the primary registration identifier, phone is a post-registration
    # secondary identifier. A phone-only register attempt is rejected as a
    # handled, enumeration-safe failure — never an opaque 500.
    Given a visitor who submits the registration form with a phone but no email
    When the request reaches the BFF
    Then the request is rejected with a generic, enumeration-safe failure
    And the response is not a 500 server error
    And no account is created

  @EARS-3 @happy
  Scenario: Verify email with the OTP code
    Given a registrant who received an email verification code
    When the registrant submits the correct code
    Then Zitadel otp_email verifies it
    And the UserMirror email_verified flag becomes true
    And an EmailVerified entry is appended to audit_ledger

  @EARS-3 @failure
  Scenario: Expired email verification code is rejected
    Given a registrant whose email verification code has expired
    When the registrant submits that code
    Then a generic failure is returned
    And the attempt counts against the OTP attempt limit

  @EARS-5 @EARS-8 @happy
  Scenario: Log in with password and establish a BFF session
    Given a verified doctor_guest user
    When the user submits the correct identifier and password
    Then Zitadel verifies the password in a session
    And the BFF completes the OIDC exchange and stores the rotating refresh token in Redis
    And a __Host- session cookie is set with HttpOnly, Secure, and SameSite=Lax
    And no token appears in the response body

  @EARS-5 @EARS-16 @failure
  Scenario: Wrong password returns a generic error and increments the lockout counter
    Given a verified doctor_guest user
    When the user submits a wrong password
    Then a generic authentication error is returned
    And the failed-attempt counter is incremented

  @EARS-6 @EARS-8 @happy
  Scenario: Passwordless login with an email OTP code
    Given a verified doctor_guest user
    When the user requests an email login code and submits the correct code
    Then Zitadel otp_email verifies it
    And a BFF session is established with a __Host- cookie

  @EARS-7 @EARS-14 @happy
  Scenario: Login with an SMS OTP code within the toll-fraud budget
    Given a verified doctor_guest user whose phone is under all SMS thresholds
    When the user requests an SMS login code and submits the correct code
    Then Zitadel otp_sms verifies it
    And a BFF session is established

  @EARS-14 @failure
  Scenario: SMS send refused when the daily budget circuit-breaker is open
    Given the global daily SMS budget has been exhausted
    When a user requests an SMS login code
    Then no SMS is sent to the provider
    And a generic "try again later" response is returned

  @EARS-9 @happy
  Scenario: Refresh rotation issues a new access token
    Given an authenticated session whose access token has expired
    When the client makes a request with the valid session cookie
    Then the refresh token is rotated single-use
    And a new access token is issued

  @EARS-9 @failure
  Scenario: Replaying a consumed refresh token invalidates the chain
    Given a refresh token that has already been rotated once
    When that consumed refresh token is presented again
    Then the entire refresh chain is invalidated
    And the session is revoked
    And a RefreshReuseDetected event is appended to audit_ledger

  @EARS-10 @happy
  Scenario: Logout revokes the session
    Given an authenticated doctor_guest session
    When the user requests logout
    Then the server-side session is deleted
    And the __Host- cookie is cleared
    And a SessionRevoked event is recorded

  @EARS-11 @EARS-16 @happy
  Scenario: Password reset request is enumeration-resistant
    When a user requests a password reset for any identifier
    Then the response is identical whether or not the identifier exists
    And a reset code is sent only if the identifier exists

  @EARS-12 @happy
  Scenario: Completing a password reset revokes existing sessions
    Given a user with a valid reset code
    When the user submits the code and a policy-conforming new password
    Then Zitadel sets the new password
    And all existing sessions for that user are revoked
    And a PasswordResetCompleted event is recorded

  @EARS-15 @failure
  Scenario: Account soft-locks after repeated failures
    Given a doctor_guest user
    When the user submits a wrong password 10 times within 30 minutes
    Then the account is soft-locked by the Zitadel lockout policy
    And a lockout notification email is sent

  @EARS-19 @happy
  Scenario: Mirror reconciliation closes a webhook-miss divergence
    Given a Zitadel user whose create webhook was not delivered
    When the periodic reconciliation sweep runs
    Then the missing doctor_guest UserMirror row is created
    And the role grant is ensured

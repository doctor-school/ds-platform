# 003 — User authentication scenarios
# Gherkin for the net-new web auth vertical (doctor_guest over Zitadel).
# Happy paths + failure branches. Selected journeys are translated to Playwright
# via playwright-bdd as their executable steps are backfilled.
# Tags map scenarios to EARS handlers in 003-requirements-en.md.

@host:academy
Feature: Net-new web authentication producing a doctor_guest identity

  # Environment assumptions for these journeys: Zitadel is reachable and seeded
  # with doctor_guest; the portal serves inline auth forms on its configured
  # origin; rate-limit, captcha, and sms-budget guards are active. Individual
  # executable scenarios assert their own concrete prerequisites and outcomes.

  @EARS-1 @EARS-20 @EARS-19 @happy @registration-before-confirmation
  Scenario: Register with email and password
    Given an Academy visitor with a unique never-registered email
    When the visitor submits the Academy registration form with a policy-conforming password and accepted consent versions
    Then registration acknowledges pending verification with the configured per-purpose consent versions
    And the Academy code step has a fresh delivered confirmation code that remains unconsumed
    And registration exposes no password or tokens and grants no private session or profile access
    # Internal identity/default doctor_guest mirror/persisted consent evidence:
    # apps/api/test/auth/register.e2e-spec.ts EARS-1; consent refusal: EARS-20.
    # That API suite also retains EARS-16 duplicate-response/no-duplicate proof.
    # Old browser mapping: apps/portal/e2e/auth-journeys.e2e.spec.ts
    # "003 EARS-1/41/10" registration/verify arrival/mail -> registration.steps.ts.
    # Keep that full test: its confirmation/session/logout assertions are distinct.

  @EARS-20 @failure @consent-refusal
  Scenario: Registration is refused without consent
    Given an Academy visitor with unique owned credentials for the consent-refusal request
    When that browser sends a real Academy BFF registration request without any accepted consent version
    Then the consent-free registration request receives the generic validation failure
    And no PD-bearing UserMirror row exists for that exact owned registration address
    And the refused registrant has no private session, profile access, password or token exposure
    # Academy's form records tos/2026-01 from its read-only statement (no checkbox).
    # This request-level omission probe does not claim a form-level refusal.
    # Retained internal mapping: apps/api/test/auth/register.e2e-spec.ts EARS-20
    # -> consent-refusal.steps.ts: real BFF refusal + exact owned mirror count.
    # Keep broader portal registration/confirmation journeys and the API test.

  @EARS-1 @EARS-16 @failure
  Scenario: Registration with an already-registered email is enumeration-resistant
    Given an email that is already registered
    When a visitor submits the registration form with that email
    Then the response is indistinguishable in status, body, and timing from the never-registered case
    And no duplicate account is created

  @EARS-23 @EARS-16 @happy
  Scenario: Already-registered email receives a code mail and nothing is written before the code
    # Production amendment 2026-10-02 (#2553): the owner receives a code, never a
    # dead-end notice; the API response is identical to the never-registered case.
    Given an email that is already registered
    When a visitor submits the registration form with that email
    Then a code-only mail with no link is sent to that address, saying the address is already registered
    And no account, consent, or audit_ledger row is written before a code is accepted
    And the API response is indistinguishable in status, body, and timing from the never-registered case

  @EARS-23 @EARS-41 @happy
  Scenario: A verified password holder who re-registers is signed in by the code and keeps the password
    Given a verified account with a password for "owner@example.org"
    When a visitor submits the registration form for "owner@example.org" with a different password and a display name
    Then the mail says the address is already registered and «Ваш пароль не изменился»
    When the visitor enters the code from that mail on the code step
    Then a BFF session is established and the return target is honoured
    And the original password still signs in and the submitted one does not
    And the display name is written only if the account had none

  @EARS-23 @EARS-41 @happy
  Scenario: An abandoned registrant who registers again gets the new password, not the abandoned one
    Given an unverified account for "late@example.org" created by a registration with password "first-pass"
    When a visitor submits the registration form for "late@example.org" with password "second-pass"
    Then the mail says the password entered will be saved after the code, not that it is unchanged
    When the visitor enters the code from that mail on the code step
    Then email_verified becomes true and a BFF session is established
    And "second-pass" signs in and "first-pass" does not

  @EARS-41 @failure
  Scenario: A password set before verification does not survive the owner's first code
    # Lead security decision 2026-10-02: a squatter who registered the owner's address
    # with their own password loses it at the owner's first accepted code.
    Given an unverified account for "victim@example.org" whose password was set by someone else
    When the mailbox owner requests a sign-in code and enters it
    Then email_verified becomes true and the owner is signed in
    And the pre-verification password no longer signs in
    And every session the account held before the code is revoked

  @EARS-23 @EARS-41 @happy
  Scenario: A password-less congress account that registers gets the entered password after the code
    Given a congress-created account for "guest@example.org" with no credential and an unverified email
    When a visitor submits the registration form for "guest@example.org" with a policy-conforming password
    And enters the code from the mail on the code step
    Then email_verified becomes true and a BFF session is established
    And the submitted password now signs in
    And profile fields the account already holds are not overwritten
    And the platform consent ticked on the form is recorded only after the code is accepted

  @EARS-23 @EARS-41 @happy
  Scenario: Re-registration never overwrites an existing platform consent
    Given a verified account for "owner@example.org" that already holds a platform consent
    When a visitor submits the registration form for "owner@example.org" with accepted consent versions
    And enters the code from the mail on the code step
    Then a BFF session is established
    And no second platform consent row is written and the existing consent is unchanged

  @EARS-23 @failure
  Scenario: Repeated duplicate registrations do not flood the inbox
    Given an email that is already registered
    And a re-registration code mail was just sent to that address
    When a visitor submits the registration form with that email again within the throttle window
    Then no second code mail is sent
    And the API response is still indistinguishable from the never-registered case

  @EARS-24 @EARS-42 @EARS-16 @happy
  Scenario: The post-registration screen is the one code step for new and existing visitors
    Given a visitor has submitted the registration form
    When the storefront shows the post-registration screen
    Then it is the one code step: "check your email", the address exactly as typed, six code cells and a resend with cooldown
    And it offers «← Изменить почту» back to the registration form with the entered fields kept
    And it offers no separate Sign in or Reset password block
    And the screen never branches on whether the email was already registered

  @EARS-25 @EARS-16 @happy
  Scenario: Resending a code is enumeration-resistant and fits the account state
    # Production amendment 2026-10-02 (#2553): a resend from any code step re-issues
    # the code that fits the account state for any existing account.
    Given a visitor on a code step requests the code be re-sent
    When the request reaches the BFF for any identifier
    Then the response is indistinguishable in status, body, and timing across unknown, verified and unverified identifiers
    And an unverified account receives a fresh verification code and a verified account a fresh login code
    And an unknown identifier receives nothing
    And an otp.sent audit_ledger row is appended only when a code is actually issued
    And the resend is subject to the EARS-13 rate limits and writes no users or consent row

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

  @EARS-3 @EARS-41 @happy @email-confirmation
  Scenario: Verify email with the OTP code
    Given an Academy visitor with a unique never-registered email
    When the visitor submits the Academy registration form with a policy-conforming password and accepted consent versions
    Then the Academy code step has a fresh delivered confirmation code that remains unconsumed
    When the registrant enters the delivered confirmation code once in the original Academy tab
    Then Academy automatically submits that code once and acknowledges verified without exposing credentials
    And confirmation opens webinars and the same email-verified account with a secure host-only session
    # Accepted EARS-41 selects the unverified-account Zitadel verification check.
    # Internal mirror proof: apps/api/test/auth/verify.e2e-spec.ts EARS-3.
    # Exactly one auth.account.verified row, same subject, channel=email, masked:
    # apps/api/test/auth/audit-ledger.e2e-spec.ts EARS-18. No browser ledger reads.
    # Old browser mapping: apps/portal/e2e/auth-journeys.e2e.spec.ts
    # "003 EARS-1/41/10" code/auto-session assertions -> registration.steps.ts.
    # Keep that broader registration/confirmation/logout test intact.

  @EARS-3 @EARS-13 @failure @email-confirmation @expired-email-confirmation
  Scenario: Expired email verification code is rejected
    Given the live email-verification generator lifetime has been read back for this run
    And an Academy visitor with a unique never-registered email
    When the visitor submits the Academy registration form with a policy-conforming password and accepted consent versions
    Then the Academy code step has a fresh delivered confirmation code that remains unconsumed
    When the fresh delivered confirmation code has aged through that complete real lifetime in the original tab
    And the registrant enters that same delivered expired code once in the original Academy tab
    Then Academy rejects that confirmation generically on the same verification step without navigation or private access
    And the real expired refusal has exactly one masked failed-attempt record and leaves the account unverified
    # Live proof: real elapsed IdP-generator TTL, same delivered code, browser 400,
    # unchanged form/no private access, scoped read-only VerifyFailed ledger 0 -> 1.
    # OTP attempt-limit accounting is separate retained HTTP boundary evidence:
    # apps/api/test/auth/abuse-limits.e2e-spec.ts EARS-13 registration /verify
    # admits exactly three refused submissions then 429. RateLimitGuard consumes
    # before verify; AuthController refunds/resets only after successful verify.
    # A ledger row alone does not prove a limiter debit; fake wrong-code API
    # checks do not prove real expiry. Keep both evidence layers attributed.

  @EARS-5 @EARS-8 @happy
  Scenario: Log in with password and establish a BFF session
    Given the golden doctor "verified-cardiologist" is available for password sign-in
    When that doctor signs in through the Academy password form
    Then the Academy opens the authenticated webinar listing
    And the doctor's own profile is readable through the BFF
    And the browser holds a host-only __Host-ds_session cookie with HttpOnly, Secure, and SameSite=Lax
    And neither the login response nor JavaScript-readable browser stores expose access or refresh tokens
    # API EARS-5/EARS-8 tests own IdP password-check and Redis refresh-token proof.

  @EARS-5 @EARS-16 @failure
  Scenario: Wrong password returns a generic error without a private session
    Given the golden doctor "verified-cardiologist" is available for password sign-in
    When that doctor submits a wrong password through the Academy password form
    Then the Academy shows the generic password sign-in error
    And the refused login sets no BFF session cookie
    And the doctor's private profile is not readable through the BFF
    # API EARS-5 test owns the IdP failed-attempt increment assertion. The browser
    # verifies the live refusal without claiming to read Zitadel's native counter.

  @EARS-6 @EARS-8 @EARS-41 @happy
  Scenario: Passwordless login with an email OTP code
    Given the golden doctor "verified-cardiologist" has a verified email for code sign-in
    When that doctor requests an email login code and submits the delivered code through Academy
    Then the email-code login succeeds and opens the authenticated webinar listing
    And the browser holds a host-only __Host-ds_session cookie with HttpOnly, Secure, and SameSite=Lax
    And the doctor's own profile is readable through the BFF
    And neither the login response nor JavaScript-readable browser stores expose access or refresh tokens

  @EARS-34 @EARS-41 @EARS-16 @happy
  Scenario: An unverified account signs in with the code from the sign-in mail
    # Production amendment 2026-10-02 (#2553): Zitadel cannot arm otp_email for an
    # unverified address, so the verification code travels in the same sign-in mail
    # and entering it verifies the address and signs the user in.
    Given an existing doctor_guest account whose email is not yet verified
    When the user requests an email login code for that identifier
    Then no otp_email login challenge is armed for the unverified account
    And the same code-only sign-in mail as for a verified account is sent, carrying the verification code
    And the response is indistinguishable in status, body, and timing from the verified and nonexistent cases
    And an otp.sent audit_ledger row is appended only because a code was issued
    When the user enters that code on the six-cell code step
    Then email_verified becomes true with one auth.account.verified audit_ledger row
    And a BFF session is established with a __Host- cookie

  @EARS-34 @EARS-16 @happy
  Scenario: A login-email-code request for a verified account arms the challenge unchanged
    Given a verified doctor_guest user
    When the user requests an email login code for that identifier
    Then the Zitadel otp_email login challenge is armed as usual
    And no verification email is sent
    And the response is indistinguishable in status, body, and timing from the unverified and nonexistent cases

  @EARS-34 @EARS-16 @failure
  Scenario: A login-email-code request for a nonexistent identifier is a silent no-op
    Given an identifier that resolves to no account
    When a visitor requests an email login code for that identifier
    Then no otp_email challenge is armed and no email is sent
    And no audit_ledger, users, or consent row is written
    And the response is indistinguishable in status, body, and timing from the existing-account cases

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

  @EARS-17 @happy
  Scenario: A protected auth send executes an invisible challenge only on demand
    Given no permanent CAPTCHA checkbox is rendered in the auth form
    When a visitor submits registration, requests an initial login or reset code, or clicks any code resend
    Then the portal executes a fresh provider-native invisible SmartCaptcha check
    And provider challenge UI appears only if Yandex requires interaction
    And the first success callback resumes that pending action exactly once with the fresh token
    And duplicate callbacks or a previously used token cannot replay the action

  @EARS-17 @happy
  Scenario: Password login challenges only after the backend threshold
    Given a visitor has entered an identifier and password
    When the visitor submits password login before the failed-login threshold
    Then the portal sends the login request without requesting CAPTCHA
    When the backend returns BOT_PROTECTION_REQUIRED after the threshold
    Then the portal executes a fresh invisible challenge
    And a successful solve retries the captured original login values exactly once

  @EARS-17 @happy
  Scenario: Proving a code or completing reset is not challenged again
    Given a visitor already requested a verification, login, or reset code through a protected action
    When the visitor submits that verification code or login OTP, or completes password reset
    Then the portal sends the confirmation without requesting CAPTCHA
    When the visitor explicitly asks to resend a code
    Then the portal executes a new invisible check and uses a fresh token for that resend

  @EARS-17 @failure
  Scenario: CAPTCHA failure is truthful, terminal, theme-aware, and non-destructive
    Given the invisible widget uses the portal's resolved light or dark theme and follows a live theme change
    When its token expires, Yandex rejects it, its script or network fails, or an incomplete challenge closes
    Then the pending action is not sent or replayed
    And the widget and one-time token are reset for a fresh attempt
    And the portal preserves entered form values and shows localized CAPTCHA-specific feedback
    And a later successful solve clears only the CAPTCHA-specific feedback

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
    Given the golden doctor "verified-cardiologist" is signed in
    And the doctor has an active Academy profile and session cookie
    When the doctor logs out from the Academy account
    Then the Academy returns to its home page
    And the logout response clears the __Host-ds_session cookie
    And the old session cookie cannot read the doctor's private profile

  @EARS-11 @EARS-16 @happy
  Scenario: Password reset request is enumeration-resistant
    When a guest requests password resets through Academy for a seeded and a unique unregistered email
    Then both reset requests have identical acknowledgements and complete-step controls without a private session
    And fresh reset mail reaches only the seeded email while the unregistered email receives no mail for 15 seconds

  @EARS-12 @happy @password-reset-complete
  Scenario: Completing a password reset revokes existing sessions and auto-logs-in
    Given a uniquely registered Academy account has two independently authenticated sessions
    When that account completes the Academy reset form with its fresh delivered code and a new password
    Then reset completion opens the same account directly with a fresh secure host-only session and no exposed tokens
    And both original sessions lose profile access while the new password signs in and the old password is refused
    # PasswordResetCompleted evidence: apps/api/src/auth/auth.service.spec.ts EARS-12.
    # API session proof: apps/api/test/auth/password-reset.e2e-spec.ts EARS-12.

  @EARS-35 @EARS-12 @happy @password-reset-complete
  Scenario: A proven password reset marks the email verified and unblocks login-by-code
    Given a uniquely registered Academy account remains on verification with its confirmation code unconsumed
    When that account completes the Academy reset form with its fresh delivered code and a new password
    Then the same account profile is email-verified immediately after reset before any login-code request
    When the recovered account logs out and submits its fresh delivered Academy email login code
    Then the delivered login code opens that same account with a new secure host-only session
    # Internal IdP/mirror/terminal auth.account.verified evidence:
    # apps/api/test/auth/password-reset.e2e-spec.ts EARS-35 and
    # apps/api/src/auth/idp/zitadel.idp.spec.ts EARS-35 wire-shape tests.
    # EARS-41 also verifies on code login; the pre-login profile read isolates reset.

  @EARS-35 @EARS-16 @failure @password-reset-complete
  Scenario: A failed reset mutates nothing, including verification state
    Given a uniquely registered Academy account remains on verification with its confirmation code unconsumed
    When that account completes the Academy reset form with its guaranteed different six-digit code and a new password
    Then the Academy reset form rejects the code generically without a session or private profile access
    # Internal EARS-35/16 evidence: apps/api/src/auth/auth.service.spec.ts
    # "a bad reset code preserves credentials, sessions and verification" proves
    # unchanged credentials, sessions and IdP/mirror verification, and permits
    # PasswordResetFailed only: no reset-completed, login-success or terminal
    # account-verification audit effects. The browser cannot read this state.
    # Mirror persistence: apps/api/test/auth/password-reset.e2e-spec.ts EARS-35/16.
    # This case proves a bad code, not expiry or a browser timing bound.

  @EARS-13 @happy
  Scenario: A successful login forgives the per-user rate-limit window
    Given a user who has made several failed login attempts within the per-user window
    When the user then submits the correct credentials within the window and succeeds
    Then the per-user rate-limit window for that identifier is cleared
    And a subsequent attempt for that identifier is not throttled
    But the per-IP and per-ASN windows are not forgiven

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

  @EARS-26 @happy
  Scenario: An orphaned session self-heals its mirror on the next authenticated read
    Given a doctor_guest user with a valid BFF session
    And the user's UserMirror row is absent while the IdP session stays alive
    When the user requests an authenticated mirror-backed surface
    Then the UserMirror row is re-materialized from the IdP with the doctor_guest grant
    And the request is served normally instead of the generic 401
    And the portal never enters the silent /login to /account redirect carousel

  @EARS-26 @EARS-16 @failure
  Scenario: An unauthenticated read heals nothing and stays generic
    Given no session cookie
    When a client requests an authenticated mirror-backed surface
    Then the response is the generic 401
    And no UserMirror row is created

  @EARS-27 @happy
  Scenario: An authenticated user reads their own profile
    Given an authenticated doctor_guest session
    When the user requests GET /v1/me/profile
    Then the response carries the subject's own email, emailVerified, phone, phoneVerified, and displayName from the users mirror
    And no write is performed

  @EARS-27 @EARS-16 @failure
  Scenario: An unauthenticated profile read gets the generic auth outcome
    Given no session cookie
    When a client requests GET /v1/me/profile
    Then the response is the same generic 401 as the other /v1/me/* reads
    And no profile data is disclosed

  @EARS-28 @happy
  Scenario: The /account page renders the profile surface instead of raw claims
    Given an authenticated doctor_guest user with a verified email and no attached phone
    When the user opens the /account page
    Then the page renders avatar initials and the display name with inline edit
    And the email is shown with its verified state
    And the phone row shows the explicit "не указан" state
    And a change-password action hands off to the existing /reset flow
    And a link to "Мои события" and a sign-out action are present
    And no raw session claim (sub, roles array, raw mfa boolean) appears anywhere in the page

  @EARS-28 @happy
  Scenario: Inline display-name edit persists through the existing endpoint
    Given an authenticated doctor_guest user on the /account page
    When the user edits the display name inline and confirms
    Then the new value is persisted via the existing PUT /v1/me/display-name
    And the rendered display name and avatar initials reflect the new value

  @EARS-29 @happy
  Scenario: The verification code email is composed and sent by the BFF mailer, code-only
    Given a visitor completes a registration that triggers an email verification code
    When Zitadel returns the one-time code to the BFF via returnCode
    Then Zitadel itself sends no email
    And the BFF mailer sends exactly one branded code-only email with the code leading the subject and shown in the body
    And the email contains no link, button or navigation URL in any block including the footer
    And HTML and plain text show the same code, expiry and instruction to use the already-open requesting tab

  @EARS-29 @happy
  Scenario: The password-reset code email is BFF-sent and link-free
    Given a user requests a password reset for an existing identifier
    When Zitadel returns the reset code to the BFF via returnCode
    Then Zitadel itself sends no email
    And the BFF mailer sends the branded code-only reset email with no link or button
    And the user completes the reset by typing the code on the /reset screen

  @EARS-29 @EARS-34 @happy
  Scenario: Unverified-account sign-in receives the sign-in code mail
    Given an existing account has an unverified email
    When its owner requests an email sign-in code
    Then the BFF sends the verification code in the sign-in code mail on the existing shared mailer layout
    And HTML and plain text show the code, its lifetime and the instruction to use the already-open requesting tab
    And no link, button or navigation URL appears in any email block
    And the code is six digits, its lifetime owned by Zitadel

  @EARS-23 @EARS-29 @happy
  Scenario: The re-registration mail is a code mail on the shared layout
    Given registration targets an existing account
    When the BFF composes the re-registration mail
    Then the mail uses the existing shared mailer layout and carries the code
    And HTML and plain text say the address is already registered, adding «Ваш пароль не изменился» only for a verified account with a password and otherwise that the entered password will be saved after the code
    And neither body contains a link, button or navigation URL

  @EARS-31 @EARS-32 @happy
  Scenario: Postbox acceptance stops the chain
    Given real mode explicitly selects a complete Postbox SMTP primary
    And the mail.ru reserve and Resend are enabled and configured
    When the BFF sends a verification or reset email to any recipient domain
    Then only Postbox is called
    And its final SMTP 2xx to the end-of-data sequence is recorded as provider acceptance, not delivery or Inbox placement
    And the terminal outcome is accepted-by-postbox with the actual provider label

  @EARS-31 @EARS-45 @EARS-32 @happy
  Scenario: A definitive Postbox failure is delivered through mail.ru
    Given the mail.ru reserve is enabled with its own complete credentials
    And Postbox returns a definitive pre-acceptance "451 Ratelimit exceeded" rejection
    When the BFF mailer dispatches a verification or reset email
    Then mail.ru is called once with the same code and identical UTF-8 content
    And a mail.ru final 2xx is recorded as accepted-by-mail.ru
    And Resend is not called

  @EARS-31 @EARS-45 @EARS-32 @happy
  Scenario: Postbox and mail.ru provider failures are delivered through Resend
    Given the mail.ru reserve and Resend are enabled and configured
    And Postbox and mail.ru both end in provider-failure
    When the BFF mailer dispatches a verification or reset email
    Then Resend is called once with the same code and identical content and click and open tracking off
    And a Resend 2xx is recorded as accepted-by-resend
    And one redacted event per attempt names the actual provider and its outcome class

  @EARS-31 @EARS-45 @EARS-16 @failure
  Scenario: Every channel failing is recorded and never leaks into the API response
    Given every enabled channel ends in provider-failure
    When a registration triggers the verification email
    Then the chain terminal outcome is exhausted with sanitized provider-code diagnostics
    And the API response stays enumeration-safe in status, body and timing
    And the visitor can recover via the verify resend affordance

  @EARS-45 @EARS-16 @failure
  Scenario Outline: A permanently refused recipient stops at the first channel
    Given Postbox refuses the recipient address with <refusal>
    And the mail.ru reserve and Resend are enabled and configured
    When the BFF mailer dispatches a verification or reset email
    Then neither mail.ru nor Resend is called
    And the terminal outcome is stopped-recipient-permanent
    And the API response stays enumeration-safe in status, body and timing

    Examples:
      | refusal                                  |
      | an enhanced status 5.1.1 on the RCPT TO reply |
      | an enhanced status 5.1.6 on the RCPT TO reply |

  @EARS-45 @happy
  Scenario Outline: A refusal that is not a recipient-address status moves to the next channel
    Given Postbox answers <reply>
    And the mail.ru reserve is enabled with its own complete credentials
    When the BFF mailer dispatches a verification or reset email
    Then the attempt is a provider-failure and mail.ru is called next

    Examples:
      | reply                                    |
      | RCPT TO with "550 5.7.1"                 |
      | RCPT TO with a bare "550", no enhanced code |
      | MAIL FROM with "553 5.1.8"               |

  @EARS-45 @failure
  Scenario: A lost acknowledgement after the end-of-data sequence stops the chain
    Given Postbox received the complete end-of-data sequence
    And no final reply arrives before the attempt ends by timeout or connection loss
    And the mail.ru reserve and Resend are enabled and configured
    When the BFF mailer dispatches a verification or reset email
    Then no further channel is called and nothing is resent
    And the terminal outcome is stopped-ambiguous

  @EARS-45 @failure
  Scenario: An unknown SMTP phase is treated as ambiguous
    Given Postbox ends with a timeout the adapter cannot place before or after the end-of-data sequence
    When the BFF mailer dispatches a verification or reset email
    Then no further channel is called and nothing is resent
    And the terminal outcome is stopped-ambiguous

  @EARS-45 @happy
  Scenario Outline: A failure before the message body was committed is definitive
    Given the mail.ru reserve is enabled with its own complete credentials
    And Postbox ends with <failure> before the end-of-data sequence was written
    When the BFF mailer dispatches a verification or reset email
    Then the attempt is a provider-failure and mail.ru is called next

    Examples:
      | failure                                  |
      | connection refused                       |
      | a TLS failure                            |
      | an AUTH 535 rejection                    |
      | a 4xx reply                              |
      | a timeout or connection loss before data |

  @EARS-31 @EARS-46 @happy
  Scenario: A disabled mail.ru reserve is skipped and not counted as reserve
    Given the mail.ru enable switch is off even though its credentials exist
    When Postbox ends in provider-failure
    Then mail.ru is not called and the chain continues to Resend if enabled and configured
    And the terminal event counts the skipped channel
    And the readiness statement for mail.ru is disabled and it is not reported as operational reserve

  @EARS-31 @failure
  Scenario: An enabled mail.ru reserve with incomplete credentials is a startup error
    Given the mail.ru enable switch is on
    And one of its credentials or its sender is missing
    When the application validates the mailer configuration at startup
    Then it raises a sanitized configuration failure instead of silently skipping the channel
    And neither Mailpit nor any real provider receives a send

  @EARS-31 @failure
  Scenario Outline: Invalid real configuration cannot fall through to another sender
    Given real delivery mode is selected by the flag or environment
    And the configuration is <invalid>
    When the mailer validates or dispatches the send
    Then it raises a sanitized configuration failure
    And neither Mailpit nor any real provider receives the send

    Examples:
      | invalid                                       |
      | missing the primary discriminator             |
      | an unknown provider                           |
      | a provider and host mismatch                  |
      | missing primary credentials or sender         |
      | enabled Resend without valid credentials      |
      | a mail.ru reserve identical to the primary    |

  @EARS-31 @EARS-46 @happy
  Scenario: Channels have independent credentials and only verified channels are reserve
    Given the primary uses IDP_SMTP_REAL_* and the mail.ru reserve uses its own MAILER_FALLBACK_SMTP_* set
    When readiness is evaluated without sending any message
    Then each channel reports disabled, absent, configured-unverified, probe-failed or verified
    And only a channel whose authenticated handshake or key check succeeded counts as operational reserve
    And a Resend sending-only key answering restricted_api_key 401 is verified while an invalid key is probe-failed
    And the statement contains no secret, credential or recipient address

  @EARS-31 @happy
  Scenario: Rollback is configuration only and explicit intercept remains deliberate
    Given the chain is Postbox, mail.ru and Resend
    When the mail.ru enable switch is turned off
    Then the chain is Postbox then Resend
    When both reserve switches are off
    Then only Postbox is used
    When the primary is switched back to mail.ru
    Then the mail.ru reserve switch must be off or startup fails
    When intercept mode is explicitly selected instead
    Then only the configured Mailpit intercept receives the next email

  @EARS-31 @EARS-45 @EARS-30 @EARS-32 @failure
  Scenario Outline: A stalled transport terminates and cannot report late success
    Given a local transport stalls at <phase>
    When the configured phase or whole-attempt deadline expires
    Then the owned socket or HTTP operation is cancelled and timers are cleared
    And a late connection handoff is destroyed and cannot transmit the message
    And a late success callback cannot overwrite the terminal local outcome
    And the chain continues only if the end-of-data sequence or HTTP request had not been sent
    And no automatic failover occurs when remote acceptance is uncertain
    And diagnostics contain no recipient, subject, body, credential or one-time code

    Examples:
      | phase                               |
      | SMTP connect or greeting            |
      | SMTP socket inactivity              |
      | SMTP whole-send absolute deadline   |
      | HTTP connection or response headers |
      | HTTP response-body consumption      |

  @EARS-31 @EARS-16 @failure
  Scenario: Total chain budget expiry cancels the in-flight attempt
    Given Postbox and mail.ru end in provider-failure after consuming their deadlines
    And the Resend attempt is still in flight when the 40 s total budget expires
    When the budget expires
    Then the Resend fetch is aborted and its timers are cleared
    And the in-flight attempt is classified by its phase and no further channel is tried
    And the terminal outcome is stopped-budget
    And a late Resend 2xx cannot report success
    And the API response timing is unchanged because the send is detached

  @EARS-31 @EARS-32 @failure
  Scenario: Provider acceptance does not trigger resend when mailbox placement is poor
    Given Postbox accepted a message with a final SMTP 2xx
    When a received artifact reports DKIM timeout or Junk placement
    Then the mailer does not automatically resend or call any other channel
    And the received-header investigation remains separate from synchronous acceptance
    And TrustedSenderList-assisted Inbox placement is not counted as an unassisted pass

  @EARS-6 @EARS-31 @happy
  Scenario: Login OTP uses the existing BFF mailer and shared code-only layout
    Given a verified account and the existing mailer delivery configuration
    When a verified user requests an email login OTP
    Then the BFF obtains the six-digit code through otpEmail returnCode
    And Zitadel sends no native email
    And the existing BFF mailer sends the code using the shared layout through the Postbox → mail.ru → Resend chain
    And HTML and plain text state a five-minute lifetime and entry in the already-open requesting tab
    And neither body nor footer contains a button, anchor or navigation URL
    And the code remains server-only outside the email and is never persisted or logged
    And the same code completes the existing Zitadel session verification and BFF session flow

  @EARS-6 @EARS-31 @failure
  Scenario: A successful native SMTP write without converged readback cannot activate a release
    Given a candidate SMTP create or activation returned success
    And its projected metadata or active ID does not match the intended configuration
    When the bounded convergence budget expires
    Then deployment fails before replacing the running application
    And any changed native selection is restored to the retained original ID
    And a profile test response alone is not treated as native delivery proof

  @EARS-6 @EARS-31 @happy
  Scenario: Runtime reconciliation selects the configured real provider after deployment
    Given the new application explicitly selects Postbox with matching native profile metadata
    When startup, SDK synchronization or any flag change triggers real-email reconciliation
    Then runtime selects the separate Postbox profile without rewriting mail.ru
    And deployment verifies the active Postbox ID after the application is ready
    And SMS reconciliation and nonproduction intercept behavior remain unchanged

  @EARS-6 @EARS-31 @happy
  Scenario: A controlled rollback uses the retained mail.ru identity
    Given the separate Postbox profile is active
    When controlled rollback restores the coherent previous configuration
    Then deployment reactivates the original mail.ru ID without updating its credentials
    And a real native notification and a BFF send are verified through mail.ru
    And both profile IDs remain available without duplicate creation

  @EARS-30 @failure
  Scenario: The one-time code never reaches the logs
    Given a verification or reset send with any outcome including success, failover, and total failure
    When the BFF logs, audits, or reports on the send
    Then no log line, trace, error report, or audit_ledger row contains the one-time code

  @EARS-33 @happy
  Scenario: With the suppression toggle on, a synthetic-tagged send is dropped before the relay
    Given the synthetic-send suppression toggle is on
    And the reserved synthetic recipient domain is "@loadtest.invalid"
    When the BFF dispatches a verification, reset, or OTP send to a recipient at the synthetic domain
    Then the send is dropped before any relay or provider call
    And no real email or SMS leaves the platform
    And a synthetic-suppressed counter and log line are emitted for the send

  @EARS-33 @happy
  Scenario: With the suppression toggle on, an untagged send proceeds normally
    Given the synthetic-send suppression toggle is on
    When the BFF dispatches a send to a recipient at a real, non-synthetic domain
    Then the send proceeds to the transport chain unchanged
    And no send is suppressed or counted as synthetic

  @EARS-33 @failure
  Scenario: With the suppression toggle off, the seam is inert for every recipient
    Given the synthetic-send suppression toggle is off
    When the BFF dispatches a send to a synthetic-tagged recipient
    And the BFF dispatches a send to a real-domain recipient
    Then both sends proceed to the transport chain unchanged
    And no send is suppressed, regardless of the recipient tag

  @EARS-36 @happy @password-minimum
  Scenario: A password of eight characters with no character classes is accepted
    Given the IdP instance complexity policy is provisioned as minimum length 8 with every character-class flag off
    And an Academy length-only registrant with a unique never-registered email
    When the length-only registrant submits exactly eight lowercase letters "pinecone" with accepted consent versions
    And the length-only registrant enters that fresh delivered confirmation code once
    Then that one confirmation opens the verified length-only account with a secure session and no additional sign-in

  @EARS-36 @failure @password-refusal
  Scenario: A password shorter than the minimum length is rejected by the single rule
    Given an Academy short-password registrant with a unique never-registered email and the account return target
    When that registrant enters seven lowercase letters, blurs the password and attempts the normal registration submit
    Then only the minimum-length rule rejects that password without any registration POST or private access
    When that registrant corrects the same password field to eight lowercase letters without submitting
    Then the length error clears and normal submission is available with the same address and registration context and no account created
    # Retain schemas/auth.schema.spec.ts seven-character rejection and portal
    # identifier-validation.e2e.spec.ts blur-only copy checks: neither proves
    # the normal submit refusal and correction on the shared live Academy flow.

  @EARS-36 @happy
  Scenario: A credential created under the previous four-class policy still signs in
    Given an account whose password was created under the previous four-class policy
    When the owner signs in with that unchanged password
    Then the sign-in succeeds
    And the owner is never asked to rotate or re-validate the password

  @EARS-37 @happy
  Scenario: The single password rule is visible before submission
    Given a visitor opens the registration form
    When the password field is rendered and before any interaction
    Then the single rule "Не менее 8 символов" is visible
    And no requirement checklist, strength meter, or second requirement is shown

  @EARS-37 @failure
  Scenario: The validation error replaces the hint in the one message slot
    Given a visitor on the registration form
    When the visitor submits a password that is too short
    Then the validation error is shown in the field's single message slot
    And the hint is no longer rendered in that slot
    And the error names the same single rule as the hint

  @EARS-38 @happy
  Scenario Outline: Every password field carries a keyboard-operable reveal toggle
    Given a visitor on the <surface> form
    When the visitor focuses the password field
    Then the field is masked by default and renders a show-password toggle
    When the visitor activates the toggle with the keyboard
    Then the entered value is rendered in plain text
    And the accessible state and label of the toggle reflect the revealed state
    And the entered value and caret position are preserved

    Examples:
      | surface        |
      | registration   |
      | reset-complete |
      | password login |

  @EARS-38 @failure
  Scenario: Revealing a password has no side effect and never survives a reload
    Given a visitor has revealed the password on the registration form
    When the page is reloaded
    Then the password field is masked again
    And revealing emitted no network request, log entry, or storage write

  @EARS-39 @EARS-41 @happy @cold-email-confirmation
  Scenario: A cold verification step still signs in by the code
    Given a uniquely registered Academy account awaits its fresh unconsumed confirmation code with the account return target
    When the registrant hard reloads the Academy verification step before entering any code
    Then the reloaded step keeps the same address and account return target without private access
    When the registrant enters that same delivered six-digit code once on the cold step
    Then the cold verification submits only that address and code once and opens the verified owned account with a secure session
    And the verification journey never visits login, replays registration, or requests another code mail
    When a separate guest browser submits the original registration password for that account
    Then that password is refused generically and the guest has no private session or profile access
    # Hard reload is the actual cold-state trigger; restored tabs and hold expiry
    # remain in packages/auth-flow/src/verify/verify-door.test.tsx EARS-39/41.
    # Internal password invalidation: apps/api/src/auth/idp/zitadel.idp.spec.ts
    # EARS-41; retain both mocked contracts, which are not this live browser proof.

  @EARS-39 @EARS-41 @failure @email-confirmation
  Scenario: A refused code keeps the registrant on the verification step
    Given an Academy visitor with a unique never-registered email
    When the visitor submits the Academy registration form with a policy-conforming password and accepted consent versions
    Then the Academy code step has a fresh delivered confirmation code that remains unconsumed
    When the registrant enters a guaranteed different six-digit confirmation code once in the original Academy tab
    Then Academy rejects that confirmation generically on the same verification step without navigation or private access
    # Wrong code only; expiry remains in "Expired email verification code is rejected".
    # Old component mapping: packages/auth-flow/src/verify/verify-door.test.tsx
    # "003 EARS-16 / EARS-41: a refused code keeps the visitor on the step..."
    # -> EARS-39/41 registration.steps.ts live refusal; retain component coverage.
    # Internal mirror proof: apps/api/test/auth/verify.e2e-spec.ts EARS-3.
    # Its EARS-41 test owns the identifier-triad timing proof, not this browser case.

  @EARS-39 @failure
  Scenario: The held registration password is never persisted anywhere
    Given a registrant moving from /register to /verify
    When the password hold is inspected on every path including reload and abandonment
    Then the password is absent from the URL, localStorage, sessionStorage, and cookies

  @EARS-40 @failure @bare-verification
  Scenario: A /verify opened with no address goes to the registration door
    Given a clean Academy browser with no private session for an address-less verification arrival
    When that visitor opens bare /verify and the route mounts
    Then registration replaces that address-less arrival and Back never returns to /verify
    And the bare verification server HTML and mounted journey render no verification step, generic account description or auth frame
    When that visitor opens /verify without an address but with a same-origin webinar return target
    Then registration replaces the arrival with that exact return target and grants no private access or auth command
    # Migrated mapping: apps/portal/e2e/verify-bare-entry.e2e.spec.ts first three
    # EARS-40 cases -> bare-verification.steps.ts, including HTML and history.
    # Retain fragment and positive ?email= cases plus auth-flow unit contracts.

  @EARS-41 @EARS-16 @failure
  Scenario: A wrong code fails identically for every identifier
    Given a verified account, an unverified account and an unknown identifier
    When a wrong six-digit code is submitted for each
    Then each response is the same generic failure in status, body, and timing within 50 ms
    And no account state changes

  @EARS-42 @happy
  Scenario: No eight-cell code step exists on either storefront
    When a user reaches the code step from login by code, registration or re-registration
    Then the step shows six code cells, the address exactly as typed and a resend with cooldown
    And the back link reads «← Изменить способ» in login and «← Изменить почту» in registration

  @EARS-43 @happy
  Scenario: The code method opens directly from a link
    Given the golden doctor "verified-cardiologist" has a verified email for code sign-in
    And a guest opens the Academy code-method link with the account return target
    Then the email-code method is selected and the password method remains offered
    When that doctor submits the delivered email login code without changing methods
    Then the email-code login succeeds and opens the account return target
    And the browser holds a host-only __Host-ds_session cookie with HttpOnly, Secure, and SameSite=Lax
    And the doctor's own profile is readable through the BFF
    And neither the login response nor JavaScript-readable browser stores expose access or refresh tokens

  @EARS-43 @happy @identifier-switch
  Scenario: The typed address survives a switch between the sign-in methods
    Given a guest on /login with the «Пароль» method
    When the guest types their email and a password, then switches to «По коду»
    Then the email is already in the code request field and the password is not carried
    When the guest edits the email and switches back to «Пароль»
    Then the edited email is in the identifier field
    And a typed phone number opens «По коду» on the phone channel where the storefront serves it
    And the method switches preserve the account return context without sending credentials or code requests
    # Academy serves email and SMS through @ds/auth-flow AUTH_FLOW_CHANNELS.
    # No SMS delivery, sign-in, error-state reset or other-host claim here.
    # Existing mapping: packages/design-system/src/blocks/login-card.test.tsx
    # "003 EARS-43: the typed identifier carries..." and "a carried phone..."
    # -> identifier-switch.steps.ts. Retain unit/channel-request coverage;
    # no exactly matching app-local browser test exists to remove.

  @EARS-44 @happy
  Scenario: A valid hand-off reference opens the code step with the code already sent
    Given a congress sign-up was accepted and returned a hand-off reference
    When the visitor opens /login?method=code&handoff=<ref>&returnTo=/account/congress
    Then the login code is issued to that account exactly as for a code request
    And the code step opens with «Мы отправили код на <address>» without a method choice or a captcha
    And the handoff parameter is removed from the address bar
    When the visitor enters the code from the mail
    Then a BFF session is established and the visitor is returned to "/account/congress"

  @EARS-44 @happy
  Scenario: A hand-off link opened while signed in as its own account goes straight to the target
    Given a congress sign-up was accepted for an account and returned a hand-off reference
    And the browser already holds that account's session
    When the visitor opens /login?method=code&handoff=<ref>&returnTo=/account/congress
    Then no code is sent and no redemption of the reference is counted
    And the visitor is taken to "/account/congress" without seeing a sign-in form

  @EARS-44 @happy
  Scenario: A hand-off link opened while signed in as another account signs in the reference's account
    Given a congress sign-up was accepted for account Y and returned a hand-off reference
    And the browser already holds account X's session
    When the visitor opens /login?method=code&handoff=<ref of Y>&returnTo=/account/congress
    Then the login code is issued to Y's address and the code step opens for that address
    When the visitor enters the code from Y's mail
    Then X's session is revoked, the browser holds only Y's session
    And the visitor is returned to "/account/congress" as Y

  @EARS-44 @EARS-16 @failure
  Scenario: An expired, unknown or exhausted reference falls back to the plain code entry
    Given an expired reference, an unknown reference and a reference already redeemed three times
    When the visitor opens /login?method=code&handoff=<ref> with each
    Then each shows the EARS-43 state: «По коду» preselected, an empty identifier field
    And no error page, no mail and no hint whether an address has an account is shown
    And the handoff parameter is removed from the address bar
    And the three responses are identical in status, body and timing within 50 ms

  @EARS-44 @EARS-13 @failure
  Scenario: A rate-limited redemption is refused like any code request
    Given the per-account or per-IP code-request window is exhausted
    When the visitor opens a valid hand-off link
    Then the response is the generic throttled response of EARS-13 with no address and no mail
    And the page shows the EARS-43 state with the EARS-13 generic throttled message

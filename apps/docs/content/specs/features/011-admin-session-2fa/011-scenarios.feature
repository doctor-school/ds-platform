# 011 — Admin session hardening scenarios
# Gherkin for the pre-pilot admin session tier: the dedicated __Host-ds_admin_session cookie
# (host-only, HttpOnly, Secure, SameSite=Strict) as the only credential the admin surface accepts,
# and mandatory TOTP for every platform_admin session — self-serve forced enrollment on first
# login, a TOTP challenge on every login thereafter.
# Happy path = the full arc an admin actually walks: log in with no factor → forced enrollment →
# verify → land in admin → log out → log back in → challenge → land in admin. Plus the failure
# branches that carry the security value.
# Translated to Playwright via playwright-bdd against the Refine admin app — this is a
# user-facing spec, so the browser run is a required deliverable (owned + tracked by the 011
# admin-integration + E2E child Issue, open-ears-issues step 3a), not a bare footnote. The
# assertions that a route is refused are ALSO exercised directly against the API, never only
# through the UI.
# Tags map scenarios to EARS handlers in 011-requirements-en.md. This spec has no NNN-product.md
# PRD (internal-admin security hardening — see the requirements header note), so there are no
# US-N backlinks.

Feature: Admin session hardening — a dedicated admin cookie and mandatory TOTP for platform_admin

  Background:
    Given the admin app is served on its configured admin origin and reaches the API through its /v1/* proxy
    And the doctor portal is served on its own origin with the shipped 003 session cookie "__Host-ds_session"
    And the IdP login policy allows TOTP as a second factor with check lifetimes that do not survive a login
    And the org-wide forceMfa switch is off
    And the role → mfa_required policy contains "platform_admin"
    And all endpoints and origins are read from configuration, never hardcoded

  # --- The full happy-path arc: enroll on first login, challenge on every login after ---

  @EARS-1 @EARS-3 @EARS-4 @EARS-5 @EARS-6 @happy
  Scenario: A platform_admin enrols on first login and is challenged on every login thereafter
    Given a platform_admin account with a valid password and no registered TOTP factor
    When the admin submits correct credentials at the admin origin
    Then no admin session cookie is issued
    And the admin is placed in the mfa_pending_enrollment state
    And the admin app renders only the TOTP enrollment screen
    When the admin opens the enrollment screen
    Then a scannable QR code is presented
    And the same secret is presented in manually transcribable form
    When the admin submits the correct first code from their authenticator
    Then the TOTP factor is registered
    And an MFA-enrolled audit row is appended without the secret
    And a "__Host-ds_admin_session" cookie is set with no Domain attribute, Path=/, HttpOnly, Secure and SameSite=Strict
    And the cookie value is an opaque server-side reference rather than a token
    And the admin session carries mfa = true
    And the admin lands on the admin surface without being asked to log in a second time
    When the admin logs out
    Then the admin session record is deleted and only the admin cookie is cleared
    When the admin submits correct credentials at the admin origin again
    Then the admin is placed in the mfa_pending_challenge state
    And no admin route is reachable
    When the admin submits a correct current TOTP code
    Then a new "__Host-ds_admin_session" cookie is issued with mfa = true
    And the admin lands on the admin surface

  # --- Cookie separation: the wave-1 weakness this spec exists to close ---

  @EARS-2 @failure
  Scenario: The doctor portal session cannot reach an admin route
    Given a signed-in doctor holding a valid "__Host-ds_session" portal cookie
    And no "__Host-ds_admin_session" cookie is present
    When a request is made to an admin route through the admin origin
    Then the request is refused as unauthenticated
    And a session-rejected audit row is appended carrying the admin tier
    And no admin data is returned in the response body

  @EARS-2 @failure
  Scenario: The admin session cannot reach a portal route, and logout does not cross the two tiers
    Given an admin holding a valid "__Host-ds_admin_session" cookie
    And the same browser also holds a valid "__Host-ds_session" portal cookie
    When a request is made to a portal route presenting only the admin cookie
    Then the request is refused as unauthenticated
    When the admin logs out of the admin app
    Then only the admin cookie is cleared
    And the concurrent portal session remains valid

  # --- The forced-enrollment gate is not a UI suggestion ---

  @EARS-4 @failure
  Scenario: An admin pending enrollment cannot bypass the gate by typing a URL
    Given a platform_admin in the mfa_pending_enrollment state
    When the admin navigates directly to an admin resource URL
    Then the admin is returned to the TOTP enrollment screen
    And the corresponding admin API route refuses the request
    And no admin data appears in the page or in any network response
    And the enrollment state cannot be dismissed or skipped

  @EARS-3 @failure
  Scenario: The pending-auth reference is not a session
    Given a platform_admin who has completed primary authentication but not a second factor
    When the pending-auth reference is presented to an admin route other than the enrollment and challenge endpoints
    Then the request is refused
    And the admin session hook does not resolve an admin principal from it

  # --- Failed codes: uniform, budgeted, and lockable ---

  @EARS-7 @failure
  Scenario: A wrong code, an unregistered factor and a locked account are indistinguishable
    Given a platform_admin at the TOTP challenge screen
    When an incorrect code is submitted
    Then the response body and status are identical to the response for an unregistered factor
    And the response body and status are identical to the response for a locked account
    And the response times differ by no more than the specified timing delta
    And an MFA-failure audit row is appended
    And the failed attempt counts against both the per-user and the per-IP budget
    And the admin auth state endpoint discloses neither the lock state nor the remaining attempt budget

  @EARS-7 @failure
  Scenario: Crossing the lockout threshold soft-locks the account, and a correct code does not rescue it
    Given a platform_admin at the TOTP challenge screen
    When incorrect codes are submitted until the account lockout threshold is crossed
    Then the account is soft-locked
    And a lockout-triggered audit row is appended
    And the account-lockout notification is sent
    When a correct current TOTP code is submitted while the account is soft-locked
    Then no admin session is issued
    And the same uniform failure is returned

  @EARS-6 @failure
  Scenario: A TOTP code cannot be replayed inside its validity window
    Given a platform_admin who has just satisfied the TOTP challenge with a correct code
    When the same code is submitted again within its validity window
    Then the submission is refused
    And no additional admin session is issued

  @EARS-5 @failure
  Scenario: A wrong first code leaves the factor unregistered and the enrollment offer unrepeatable
    Given a platform_admin in the mfa_pending_enrollment state who has been shown the enrollment offer
    When an incorrect first code is submitted
    Then the TOTP factor remains unconfirmed
    And the admin stays on the enrollment screen
    And no admin session is issued
    And the previously shown secret is not served again in any later response

  # --- The authorization floor ---

  @EARS-11 @failure
  Scenario: The platform_admin role alone is not enough
    Given a session carrying the platform_admin role but no verified second factor
    When a request is made to any admin route
    Then the request is refused
    And no read-only or partial admin data is served

  @EARS-11 @failure
  Scenario: A doctor and an anonymous caller are refused on every admin route
    Given a signed-in doctor_guest and an anonymous caller
    When each makes a request to an admin route
    Then every request is refused
    And no admin data is returned

  # --- The session profile applies to the new tier too ---

  @EARS-10 @failure
  Scenario: A stolen admin cookie replayed from another client is invalidated
    Given a valid "__Host-ds_admin_session" cookie bound to a client fingerprint
    When the cookie is replayed from a different user agent and network
    Then the fingerprint check fails
    And the admin session is invalidated
    And the caller is required to authenticate again with a second factor

  @EARS-10 @failure
  Scenario: A state-changing admin request without CSRF double-submit is refused
    Given an admin holding a valid admin session
    When a state-changing admin request is made without the CSRF double-submit header
    Then the request is refused

  # --- Operator factor recovery (the LD-2 path, as an audited endpoint) ---

  @EARS-13
  Scenario: An operator removes a locked-out admin's factor and that admin re-enrols
    Given at least two platform_admin operators hold an enrolled factor
    And a platform_admin operator with a valid admin session and their own authenticator to hand
    And a target platform_admin who has lost their authenticator
    When the operator invokes the factor-removal command against the target account supplying their own current TOTP code
    Then the target's TOTP factor is removed
    And exactly one factor-reset audit row is appended naming the acting operator
    When the target admin logs in with correct credentials
    Then the target is placed in the mfa_pending_enrollment state
    And the target is forced to the TOTP enrollment screen

  @EARS-13 @failure
  Scenario: Factor removal without the caller's own current code is refused
    Given a platform_admin operator with a valid admin session
    When the operator invokes the factor-removal command against another admin account without their own current TOTP code
    Then the request is refused
    And the response is identical to the uniform failure returned for a wrong code
    And the refused attempt counts against the same rate-limit budget as a failed challenge
    And the target's factor is not removed
    And the published endpoint authorization matrix does not advertise step-up protection on this route

  @EARS-13 @failure
  Scenario: An operator cannot strip their own last factor, and a doctor cannot strip anyone's
    Given a platform_admin operator with a valid admin session and their own current TOTP code
    When the operator invokes the factor-removal command against their own account holding a single factor
    Then the request is refused
    And the operator's factor remains registered
    Given a signed-in doctor_guest
    When the doctor invokes the factor-removal command against an admin account
    Then the request is refused

  @EARS-13 @LD-2
  Scenario: With a single operator the break-glass path keeps the audit trail complete
    Given fewer than two platform_admin operators hold an enrolled factor
    And the sole operator has lost their authenticator
    When the Tech Lead removes the factor through the identity provider admin API following the module runbook
    And the runbook's compensating step appends the factor-reset audit row through the ops script
    Then a factor-reset audit row exists that is shape-identical to one written by the removal endpoint
    And the row names the acting operator
    And the post-action note is recorded on the tracking issue
    When the sole operator logs in again
    Then the operator is forced to the TOTP enrollment screen

  # --- Provisioning and audit hygiene ---

  @EARS-8
  Scenario: A freshly provisioned stand is MFA-capable with no manual console step
    Given a freshly provisioned dev stand
    Then TOTP is registered as an allowed second factor on the login policy
    And the second-factor and multi-factor check lifetimes are set so a check does not survive a login
    And enrollment cannot be skipped
    And the org-wide forceMfa switch is off
    And a doctor_guest login is unaffected

  @EARS-9
  Scenario: The admin session and MFA lifecycle is auditable and secret-free
    Given an admin has enrolled a factor, logged in, failed a code, and logged out
    Then exactly one terminal audit row is appended per lifecycle event
    And each row carries the canonical wire id its domain event maps to in the specification
    And each row carries the admin tier discriminator
    And an admin-session query by tier returns no doctor portal rows
    And each row carries the actor, timestamp, IP and user agent
    And no row contains the TOTP secret, the provisioning URI or any submitted code
    And personal data fields are masked

  # --- The screens are usable by the people who have to use them ---

  @EARS-12
  Scenario: The enrollment and challenge screens are localized and accessible
    Given the enrollment screen and the challenge screen
    Then every user-facing string resolves from the typed Russian message catalog
    And no user-facing string is hardcoded
    And the code entry fields are operable by keyboard and labelled for screen readers
    And the enrollment secret is selectable as text rather than rendered only as an image
    And the QR code carries a text alternative
    And the failure message and the recovery guidance come from the catalog
    And an accessibility scan of both screens reports no violations

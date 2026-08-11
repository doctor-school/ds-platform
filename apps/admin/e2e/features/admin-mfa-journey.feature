# 011 — the admin MFA journey in the browser, translated from
# `011-scenarios.feature` to the Refine admin surface via playwright-bdd.
#
# WHAT LIVES HERE vs WHAT LIVES IN `apps/api`. The 011 security properties are
# asserted directly against the API in the Vitest e2e tier (uniform refusals,
# replay, CSRF, the audit ledger, the authz floor, break-glass, stand
# provisioning) — a browser cannot see a response body's byte-identity or an
# audit row, and pretending otherwise would be a weaker test wearing a costume.
# What a browser CAN see, and what only a browser can see, is the arc an operator
# actually walks: that a password leads to a card they cannot skip, that a
# refusal leaves them exactly where they were with one message they can read,
# that a lock does not quietly become an admission, and that the portal cookie
# they may already be carrying does not open the admin door. That is this file.
#
# Every code submitted here is derived from the secret the enrollment screen
# RENDERED, by an independent RFC 6238 implementation (`e2e/support/totp.ts`) —
# the operator's phone, modelled. A test that asked the server for the code would
# prove only that the server agrees with itself.
#
# Dev-stand-gated (a MANUAL tier, not CI): the session bootstrap provisions a
# real `platform_admin` against the stand's Zitadel and throws if the `IDP_*` env
# is absent, so a stray invocation fails fast rather than pretending to pass.

Feature: The admin MFA journey — forced enrollment, a challenge on every login after, and the branches that refuse

  @EARS-1 @EARS-3 @EARS-4 @EARS-5 @EARS-6 @happy
  Scenario: A factor-less platform_admin enrols on first login and is challenged on the next one
    Given a platform_admin account with a valid password and no registered TOTP factor
    When the admin signs in at the admin origin with correct credentials
    Then the admin is held at the TOTP enrollment screen
    And no admin route is reachable
    And the enrollment offer is both scannable and transcribable
    When the admin submits the current code from their authenticator
    Then the admin lands on the admin surface
    And the admin API answers this browser
    And the login was completed in place, with no extra password prompt
    When the admin signs out
    Then the admin is returned to the login screen
    When the admin signs in at the admin origin with correct credentials
    Then the admin is held at the TOTP challenge screen
    And the enrollment offer is not presented again
    And no admin route is reachable
    When the admin submits the current code from their authenticator
    Then the admin lands on the admin surface
    And the admin API answers this browser
    And the login was completed in place, with no extra password prompt

  @EARS-5 @failure
  Scenario: A wrong first code leaves the operator on the enrollment screen with one readable refusal
    Given a platform_admin account with a valid password and no registered TOTP factor
    When the admin signs in at the admin origin with correct credentials
    Then the admin is held at the TOTP enrollment screen
    When the admin submits the incorrect code "000000"
    Then one refusal in Russian is shown
    And the admin is held at the TOTP enrollment screen
    And no admin route is reachable
    And the code field is cleared and the submit control cannot act
    When the admin submits the current code from their authenticator
    Then the admin lands on the admin surface

  @EARS-6 @EARS-7 @failure
  Scenario: A wrong code at the challenge admits nothing and does not cost the operator their next attempt
    Given an enrolled platform_admin at the TOTP challenge screen
    When the admin submits the incorrect code "000000"
    Then one refusal in Russian is shown
    And the admin is held at the TOTP challenge screen
    And no admin route is reachable
    And the code field is cleared and the submit control cannot act
    When the admin submits the current code from their authenticator
    Then the admin lands on the admin surface
    And the admin API answers this browser

  @EARS-7 @failure @lockout
  Scenario: Once the account is soft-locked a correct current code is still refused
    Given an enrolled platform_admin at the TOTP challenge screen
    When the admin submits incorrect codes until the account lockout threshold is crossed
    Then one refusal in Russian is shown
    When the admin submits the current code from their authenticator
    Then the admin is held at the TOTP challenge screen
    And no admin route is reachable

  @EARS-2 @failure
  Scenario: A doctor portal session carried in the same browser opens no admin door
    Given a signed-in doctor holding a valid portal session cookie on the admin origin
    And no admin session cookie is present
    When an admin route is requested through the admin origin
    Then the request is refused as unauthenticated
    And no admin data is returned in the response body
    And the admin app leaves the browser outside the admin surface

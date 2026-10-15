@feature:047 @track:platform @host:admin
Feature: 047 — Staff access
  As a platform administrator
  I want to grant and revoke staff roles in the admin
  So that staff get and lose admin access without the IdP console, a database insert or a shell runbook

  Background:
    Given a platform administrator is signed in to the admin with a second factor verified within the last 30 minutes
    And the 2027 congress event exists

  @EARS-1 @EARS-2
  Scenario: The platform administrator opens «Доступы»
    When the administrator opens «Доступы» from the admin navigation
    Then the shell lands on "/access" showing "Доступы"
    And every account holding a staff role is listed with ФИО, email, роль and мероприятие, one row per role and event

  @EARS-1
  Scenario: A congress registrar does not reach «Доступы»
    Given a congress registrar is signed in to the admin
    When the registrar looks at the admin navigation
    Then the registrar's navigation has no «Доступы»
    And every staff-access endpoint refuses the registrar

  @EARS-3 @EARS-5 @EARS-6 @EARS-9
  Scenario: A new staff member gets an account and a temporary password
    Given no account holds the email "committee.new@example.org"
    When the administrator grants «Программный комитет» for the 2027 congress to "committee.new@example.org" with ФИО "Иванова Мария Петровна"
    Then an account is created with that email marked verified, the visitor role and the committee role, and no consent record
    And the 2027 congress is bound to it for the committee
    And a temporary password is shown once with a copy action
    And "auth.role.granted" is recorded with the person, the role, the event and the administrator, and without the password
    When the new staff member signs in to the admin with that email and the temporary password
    Then they are asked to connect an authenticator app before entering

  @EARS-4 @EARS-6
  Scenario: An existing account gets the role added
    Given an account with a verified email, a password and the visitor role holds the email "doctor@example.org"
    When the administrator grants «Администратор Конгресса» for the 2027 congress to "doctor@example.org"
    Then the account's existing grant holds the visitor role and the registrar role
    And no second account is created
    And no password is shown and the account's password is unchanged

  @EARS-4 @EARS-6
  Scenario: An account someone registered with the email but never confirmed is taken back
    Given an account with an unconfirmed email "staff@example.org", its own password and a signed-in session
    When the administrator grants «Администратор» to "staff@example.org"
    Then a temporary password is shown once with a copy action
    And the old password no longer signs in and the session has ended
    And the account's email is confirmed and its grant holds the visitor role and the administrator role

  @EARS-3
  Scenario: A registrar cannot be bound to a second event
    Given "registrar@example.org" is the registrar of another event
    When the administrator grants «Администратор Конгресса» for the 2027 congress to "registrar@example.org"
    Then the grant is refused with the reason at the form
    And nothing changes in the IdP or in the bindings

  @EARS-7 @EARS-9
  Scenario: Revocation closes access at once
    Given "committee.new@example.org" holds «Программный комитет» for the 2027 congress only
    And that person has an open admin session
    When the administrator confirms «Отозвать» on that row
    Then the binding is removed and the committee role leaves the account's grant, the visitor role stays
    And the person's next admin request is refused and sends them to the login
    And "auth.role.revoked" is recorded with the person, the role, the event and the administrator
    When the administrator tries to revoke their own «Администратор платформы»
    Then the revocation is refused

  @EARS-7 @EARS-9
  Scenario: A revocation the IdP cannot apply ends the sessions and is finished by repeating it
    Given "committee.new@example.org" holds «Программный комитет» for the 2027 congress only
    And that person has an open admin session
    And the IdP fails the next role change
    When the administrator confirms «Отозвать» on that row
    Then the revocation answers that the service is unavailable, with a retry
    And the person's admin session is ended
    And no "auth.role.revoked" is recorded
    When the IdP is available again and the administrator confirms «Отозвать» on the same row
    Then the committee role leaves the account's grant, the visitor role stays
    And "auth.role.revoked" is recorded once

  @EARS-8
  Scenario: A stale second factor asks for a code in the same session and the grant goes through
    Given the administrator's second factor was verified 31 minutes ago
    When the administrator submits a grant of «Программный комитет» for the 2027 congress to "committee.second@example.org"
    Then the grant is refused and nothing changes
    And the administrator is on the code screen, still signed in
    And "auth.step_up.requested" is recorded
    When the administrator enters a current code from the authenticator app
    Then the administrator is back on «Доступы» and the grant to "committee.second@example.org" completes with the entered values
    And "auth.step_up.succeeded" is recorded
    When the administrator submits another grant within 30 minutes
    Then it completes without asking for a code

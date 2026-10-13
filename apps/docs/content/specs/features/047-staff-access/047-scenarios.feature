@feature:047 @track:platform @host:admin
Feature: 047 — Staff access
  As a platform administrator
  I want to grant and revoke staff roles in the admin
  So that staff get and lose admin access without the IdP console, a database insert or a shell runbook

  Background:
    Given a platform administrator is signed in to the admin with a second factor verified within the last 30 minutes
    And the 2027 congress event exists

  @EARS-1 @EARS-2
  Scenario: Only the platform administrator reaches «Доступы»
    When the administrator opens «Доступы» from the admin navigation
    Then the shell lands on "/access" showing "Доступы"
    And every account holding a staff role is listed with ФИО, email, роль and мероприятие, one row per role and event
    Given a congress registrar is signed in to the admin
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
    Given an account with a password and the visitor role holds the email "doctor@example.org"
    When the administrator grants «Администратор Конгресса» for the 2027 congress to "doctor@example.org"
    Then the account's existing grant holds the visitor role and the registrar role
    And no second account is created
    And no password is shown and the account's password is unchanged

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

  @EARS-8
  Scenario: A stale second factor is confirmed by the authenticator code
    Given the administrator's second factor was verified 31 minutes ago
    When the administrator submits a grant
    Then the admin asks for the code from the authenticator app
    When the administrator enters a wrong code
    Then the grant is not done
    When the administrator enters the current code
    Then the grant is repeated with the entered form and completes

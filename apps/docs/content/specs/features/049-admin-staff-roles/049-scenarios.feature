@feature:049 @track:platform @host:admin
Feature: 049 — Admin staff roles
  As the person who decides who works in the admin
  I want a superadministrator role that alone manages staff access and a broadcast director role limited to events
  So that staff access is held by one role and a broadcast director runs events without reaching the rest of the admin

  Background:
    Given the 2027 congress event exists

  @EARS-1 @EARS-2
  Scenario: A broadcast director signs in with an authenticator code and is not a participant
    Given an account holds the broadcast director role and no other staff role
    When the director signs in to the admin for the first time
    Then they are asked to connect an authenticator app before entering
    When they connect it and enter a current code
    Then the shell lands on "/events" showing "Мероприятия"
    And the admin session lists the broadcast director role
    And the director is not counted among the participants of any event

  @EARS-3
  Scenario: Only the superadministrator reaches «Доступы»
    Given a superadministrator is signed in to the admin with a second factor verified within the last 30 minutes
    When the superadministrator opens «Доступы» from the admin navigation
    Then the shell lands on "/access" showing "Доступы"
    Given a platform administrator without the superadministrator role is signed in to the admin
    When the platform administrator looks at the admin navigation
    Then the navigation has every section but «Доступы»
    When the platform administrator opens "/access" directly
    Then the shell lands on "/access" showing "У этой учётной записи нет прав администратора."
    And every staff-access endpoint refuses the platform administrator

  @EARS-4 @EARS-5
  Scenario: The superadministrator grants the broadcast director role and cannot grant or revoke their own role
    Given a superadministrator is signed in to the admin with a second factor verified within the last 30 minutes
    And no account holds the email "director.new@example.org"
    When the superadministrator grants «Режиссёр трансляций» to "director.new@example.org" with ФИО "Петров Илья Сергеевич"
    Then the grant form asks for no event
    And a temporary password is shown once with a copy action
    And "auth.role.granted" is recorded with the person, the broadcast director role and the superadministrator
    And «Доступы» lists the person as «Режиссёр трансляций» with an empty event and «Отозвать»
    And «Доступы» lists the superadministrator as «Суперадминистратор» with no «Отозвать»
    And the grant form offers no «Суперадминистратор»
    When a grant naming the superadministrator role is sent to the staff-access endpoint
    Then it is refused and nothing changes
    When a revocation naming the superadministrator role is sent to the staff-access endpoint
    Then it is refused and nothing changes

  @EARS-5
  Scenario: The platform administrator role of a superadministrator cannot be revoked in «Доступы»
    Given a superadministrator is signed in to the admin with a second factor verified within the last 30 minutes
    And another account holds the superadministrator role and the platform administrator role
    When the superadministrator opens «Доступы»
    Then the other account's platform administrator row has no «Отозвать»
    When a revocation of the platform administrator role of the other account is sent to the staff-access endpoint
    Then it is refused as «STAFF_REVOKE_SUPERADMIN_HOLDER» with the reason
    And the other account still holds the superadministrator role and the platform administrator role
    And none of its admin sessions is ended and nothing is recorded

  @EARS-6
  Scenario: The operator makes the first superadministrator, and the last one cannot be removed
    Given no account holds the superadministrator role
    And an account with a verified email "owner@example.org" holds the platform administrator role
    When the operator runs the superadmin grant for "owner@example.org"
    Then the account's grant holds the visitor role, the platform administrator role and the superadministrator role
    And "auth.role.granted" is recorded once for the superadministrator role with the operator as actor
    When the operator runs the superadmin grant for "owner@example.org" again
    Then nothing changes and nothing is recorded
    When the operator runs the superadmin removal for "owner@example.org"
    Then it is refused because the account is the last superadministrator, and nothing changes
    When the operator runs the superadmin grant for "nobody@example.org"
    Then it is refused, no account is created and nothing changes
    When the operator runs the superadmin grant for "owner@example.org" naming an acting subject no IdP account has
    Then it is refused with the reason and nothing changes

  @EARS-7 @EARS-8
  Scenario: A broadcast director creates an event and runs its broadcast
    Given a broadcast director is signed in to the admin
    When the director looks at the admin navigation
    Then the navigation has only «Мероприятия»
    When the director picks a project on the create form
    Then the form fills in the event defaults from that project
    When the director creates an event "Школа кардиологии: эфир 12"
    And links an expert to it
    Then the event card shows the expert's name
    And configures its stream and publishes it
    And opens the room and then closes it
    Then each transition succeeds and is recorded with the director as actor
    And the event card has no recordings panel and no links to «Регистрации», «Приём заявок» or «Заявки»
    And the create form has no «Архивный эфир» option

  @EARS-7 @EARS-8
  Scenario: Everything outside events is closed to the broadcast director
    Given a broadcast director is signed in to the admin
    When the director opens "/projects" directly
    Then the shell lands on "/projects" showing "У этой учётной записи нет прав администратора."
    And the project write, recording, legacy-broadcast, roster and staff-access endpoints refuse the director
    Given the IdP has withdrawn the director's role
    When the director sends a live-revalidated write on an event
    Then it is refused as «BROADCAST_DIRECTOR_REQUIRED» and nothing changes

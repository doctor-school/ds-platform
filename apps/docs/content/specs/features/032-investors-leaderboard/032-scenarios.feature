@feature:032 @track:academy @host:admin
Feature: 032 — Organization registry and its admin
  As a platform administrator
  I want one registry of the organizations Doctor.School works with, each with a set of roles
  So that every surface names an organization from one record and the Academy's partner figure is true

  Background:
    Given a platform administrator is signed in to the admin with a second factor
    And the role list holds «Инвестор», «Клиническая площадка» and «Образовательный лицензиат»
    And the published partner "Фарма Плюс" is the primary partner of the project "Школа кардиологии"

  @EARS-11
  Scenario: The partners already entered appear as investor organizations
    When the administrator opens «Организации» from the admin navigation
    Then "Фарма Плюс" is listed with the role «Инвестор» and the status «Опубликована»
    And the project "Школа кардиологии" still has "Фарма Плюс" as its primary organization
    And the admin navigation has no «Партнёры»

  @EARS-1 @EARS-2 @EARS-6 @EARS-12
  Scenario: A clinic with two roles is registered and published
    Given the public partner count is 14
    When the administrator creates the organization "Клиника Здоровье" with the roles «Клиническая площадка» and «Образовательный лицензиат»
    Then "Клиника Здоровье" is a draft holding both roles
    And the public partner count is still 14
    When the administrator publishes "Клиника Здоровье"
    Then "Клиника Здоровье" is published
    And the public partner count is 15

  @EARS-6
  Scenario: An organization with no role cannot be published
    Given the draft organization "Новая компания" holds no role
    When the administrator publishes "Новая компания"
    Then the publish is refused with a field error on the roles
    And "Новая компания" stays a draft

  @EARS-10
  Scenario: A look-alike organization is flagged but not blocked
    When the administrator starts a new organization and enters the title "фарма плюс"
    Then the form shows «Похожая организация уже есть: Фарма Плюс» with «Открыть» and «Всё равно создать»
    When the administrator chooses «Всё равно создать» and saves
    Then a second draft organization "фарма плюс" exists

  @EARS-3 @EARS-4
  Scenario: The administrator extends the role list and cannot retire a role still held
    When the administrator adds the role «Производитель оборудования» in «Роли организаций»
    Then «Производитель оборудования» is offered on every organization form
    When the administrator retires the role «Инвестор»
    Then the retirement is refused, listing "Фарма Плюс" as holding it
    And «Инвестор» stays active

  @EARS-5 @EARS-12
  Scenario: An organization whose name may not be shown is counted but never displayed
    Given the published organization "Скрытая Фарма" has «Показывать название публично» off
    And "Скрытая Фарма" is a partner of the project "Школа кардиологии"
    When a visitor reads the partners of "Школа кардиологии"
    Then "Скрытая Фарма" is not among them
    And the public partner count includes "Скрытая Фарма"

  @EARS-7 @EARS-8 @EARS-12
  Scenario: A retired organization leaves the site and comes back only after a new publish
    Given the public partner count is 15
    When the administrator chooses «Снять с публикации» on "Фарма Плюс"
    Then the impact dialog lists "Школа кардиологии" as losing its display
    When the administrator confirms
    Then "Фарма Плюс" is retired and absent from every public read
    And the public partner count is 14
    And the link between "Школа кардиологии" and "Фарма Плюс" is kept
    When the administrator chooses «Вернуть» on "Фарма Плюс"
    Then "Фарма Плюс" is a draft with its roles and links
    And the public partner count is still 14

  @EARS-13
  Scenario: A congress registrar cannot reach the registry
    Given a congress registrar is signed in to the admin
    When the registrar looks at the admin navigation
    Then the registrar's navigation has neither «Организации» nor «Роли организаций»
    And every organization and organization-role endpoint refuses the registrar

  @EARS-9 @EARS-14
  Scenario: The registry list is searched and filtered on a narrow screen
    Given the admin viewport is 390 px wide
    When the administrator filters «Организации» by the role «Клиническая площадка» and searches "здоровье"
    Then only "Клиника Здоровье" is listed
    And the page does not scroll horizontally

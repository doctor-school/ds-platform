@feature:030 @track:academy @host:academy
Feature: 030 — Projects: the container, its admin, the «Все проекты» catalog and the project page
  As a visitor of the Academy and as a platform administrator
  I want every project described once, as a container of results, and shown in one catalog and on its own page
  So that the Academy's scale and its directions are read from real data and every card leads somewhere real

  Background:
    Given the output kinds «Школа», «Конгресс», «Клуб» and «Подкаст» are active
    And the published organization "Фарма Плюс" holds the role «Инвестор»
    And the published organization "ЦИТО" holds the role «Клиническая площадка»

  @EARS-1 @EARS-2 @EARS-4 @EARS-6
  Scenario: An administrator describes a project and publishes it
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator creates the project "Ортобиология" with a description and the stage «Проект идёт»
    And adds the results "Школа ортобиологии" of kind «Школа» and "Конгресс-2026" of kind «Конгресс»
    And links "Фарма Плюс" as «Инвестор проекта» and "ЦИТО" with the role «Клиническая площадка»
    And links a curator in the «Эксперты» tab
    And publishes "Ортобиология"
    Then "Ортобиология" is published
    And its catalog card reads «школа · конгресс» and «Партнёр · Фарма Плюс»

  @EARS-6
  Scenario: A project without results cannot be published
    Given a platform administrator is signed in to the admin with a second factor
    And the draft project "Педиатрия" has a title, a description, a curator and no result
    When the administrator publishes "Педиатрия"
    Then the publish is refused with a field error on the results
    And "Педиатрия" stays a draft

  @EARS-2
  Scenario: A result link outside doctor.school is refused
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator saves a result of "Ортобиология" with the link "https://example.com/school"
    Then the save is refused with a field error on the link
    And the results of "Ортобиология" are unchanged

  @EARS-3
  Scenario: An output kind in use cannot be retired
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator adds the kind «Курс» in «Виды результатов»
    Then «Курс» is offered in every results editor
    When the administrator retires the kind «Школа»
    Then the retirement is refused, listing "Ортобиология" as holding it

  @EARS-17
  Scenario: A project from the old taxonomy keeps its links and waits for its results
    Given the project "Школа кардиологии" was published by feature 012 with the kind «Школа» and two linked events
    When the administrator opens "Школа кардиологии"
    Then the form shows «Прежний тип (012): Школа — укажите результаты проекта»
    And the project list marks it «Не на сайте: нет результатов»
    And its two events are still linked
    And "Школа кардиологии" is not in the public catalog

  @EARS-5 @EARS-8 @EARS-10 @EARS-11
  Scenario: A visitor browses the catalog in the operator's order
    Given the public projects "Ортобиология" (running), "Ревматология" (soon, «идёт набор команды») and "Кто стоит за брендом" (completed)
    And the administrator ordered them "Кто стоит за брендом", "Ревматология", "Ортобиология"
    When a visitor who is not signed in opens «Проекты» from the Academy navigation
    Then the cards read "Ревматология", "Ортобиология", "Кто стоит за брендом" in that order
    And "Ревматология" carries the badge «Скоро» and the line «идёт набор команды»
    And "Кто стоит за брендом" carries the badge «Завершён»
    And "Ортобиология" carries no badge
    And no card names a project kind

  @EARS-9 @EARS-10
  Scenario: The scale line is computed from the platform
    Given there are 3 public projects and 4 published organizations
    And 98 published events since 2024 are linked to public projects
    When a visitor opens the catalog
    Then the header reads «3 проекта · 4 партнёра» and «98 эфиров с 2024 года»

  @EARS-10 @EARS-12
  Scenario: With no public project the catalog says so and the home hides its block
    Given there is no public project
    When a visitor opens the catalog
    Then the catalog says that projects are being prepared and shows the closing invitation
    And the catalog shows no card and no scale line
    When the visitor opens the Academy home
    Then the home has no projects block

  @EARS-12
  Scenario: The home shows the first three projects of the catalog
    Given there are 4 public projects in the operator's order
    When a visitor opens the Academy home
    Then the projects block shows the first three of them with the catalog card
    And «Все проекты →» opens the catalog

  @EARS-13 @EARS-14 @EARS-15 @EARS-16
  Scenario: A visitor opens a project page
    When a visitor opens the card "Ортобиология"
    Then the breadcrumb reads «Проекты / Ортобиология»
    And the hero reads «проект идёт», «Куратор проекта — » followed by the curator's name with no link
    And the hero reads «2 результата» and the since-year
    And the result "Школа ортобиологии" links «на doctor.school ↗» to its storefront page
    And «Организации в проекте» shows "Фарма Плюс" as «Инвестор проекта» and "ЦИТО" as «Клиническая площадка»
    And «Зайти как эксперт — подать заявку» leads to the application page
    And «Обсудить проект» leads to the investor page
    And the page has no dashboard, no project number, no team block, no «Закулисье» and no link to an expert page

  @EARS-8 @EARS-15
  Scenario: An investor that may not be named is shown nowhere
    Given "Фарма Плюс" has «Показывать название публично» off
    When a visitor opens the catalog and the page of "Ортобиология"
    Then neither the card nor the page names "Фарма Плюс"
    And the page shows no free investor place

  @EARS-21
  Scenario: A project with a sought specialty names it in the expert entry
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator sets «Ищем эксперта по специальности» of "Ортобиология" to «Травматология и ортопедия»
    And a visitor opens the page of "Ортобиология"
    Then the expert card of «Войти в проект» reads «Проект ищет эксперта по специальности «Травматология и ортопедия».»
    And the card keeps «Место в команде открыто» and «Зайти как эксперт — подать заявку»

  @EARS-21
  Scenario: A project with no sought specialty names none
    Given the public project "Ревматология" has no sought specialty
    When a visitor opens the page of "Ревматология"
    Then the expert card of «Войти в проект» reads «Место в команде открыто» with «Зайти как эксперт — подать заявку»
    And the expert card names no specialty

  @EARS-15
  Scenario: A project with no investor offers the free place
    Given the public project "Ревматология" has no «Инвестор проекта»
    When a visitor opens the page of "Ревматология"
    Then «Организации в проекте» shows «Стать инвестором проекта» leading to the investor page

  @EARS-14
  Scenario: The results block fails alone and retries
    Given the results read of "Ортобиология" fails once
    When a visitor opens the page of "Ортобиология"
    Then the results block reads «Не удалось загрузить результаты проекта» with «Повторить»
    And the hero and the organizations are shown
    When the visitor chooses «Повторить»
    Then the results are shown

  @EARS-7 @EARS-13 @EARS-14
  Scenario: A retired project leaves the Academy at once
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator retires "Ортобиология" through the impact dialog
    Then "Ортобиология" is absent from the catalog and from the home
    And its page address shows the Academy not-found page
    When the administrator restores "Ортобиология"
    Then "Ортобиология" is a draft with its results and links
    And it is still absent from the catalog

  @EARS-18
  Scenario: A congress registrar cannot change projects
    Given a congress registrar is signed in to the admin
    Then the registrar's navigation has neither «Проекты», «Порядок показа» nor «Виды результатов»
    And every project, result, order, organization-link and output-kind endpoint refuses the registrar

  @EARS-19
  Scenario: The doctor storefront has no projects
    When a doctor opens "/projects" on doctor.school
    Then the doctor storefront's not-found page is shown

  @EARS-20
  Scenario: The catalog and the page work on a phone
    Given the viewport is 390 px wide
    When a visitor opens the catalog and then the page of "Ортобиология"
    Then neither page scrolls horizontally
    And every card and action is reachable by keyboard

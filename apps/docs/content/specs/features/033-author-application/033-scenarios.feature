@feature:033 @track:academy @host:academy
Feature: 033 — Author application: the «Подать заявку» page and the shared application queue
  As an expert and as a platform administrator
  I want to apply under my one Doctor.School account and have every request land in one admin queue
  So that no application is lost and the team works them in one place

  Background:
    Given the personal-data consent of purpose "author-application-personal-data" has a current version
    And the team notification list is configured

  @EARS-1 @EARS-2 @EARS-3
  Scenario: A guest opens the page from the home and meets the account gate
    Given a visitor is not signed in
    When the visitor activates «Экспертам → Подать заявку» on the Academy home
    Then the page «Подать заявку» opens with «Что будет дальше» and «Условия автора»
    And the account gate «Заявка отправляется под той же учётной записью, что у врача» is shown with «Войти» and «Регистрация»
    And no form field is shown
    And the page names no producer and links to no expert page

  @EARS-3 @EARS-4
  Scenario: After sign-in the expert returns to the form
    Given a visitor is not signed in on «Подать заявку»
    When the visitor signs in as "anna@example.test" through «Войти»
    Then the visitor is back on «Подать заявку»
    And the form shows «Отправите как Анна Крылова · anna@example.test»

  @EARS-4 @EARS-6 @EARS-7 @EARS-9 @EARS-11 @EARS-12
  Scenario: A signed-in expert sends an application
    Given the expert "anna@example.test" is signed in on «Подать заявку»
    When the expert fills «Тема» with "Ортобиология в амбулаторной практике"
    And chooses the specialty "Травматология и ортопедия" and the format «курс-сериал»
    And ticks the personal-data consent
    And taps «Отправить заявку»
    Then the page shows «Заявка отправлена»
    And one application of kind "author" with status "new" is stored with its consent record
    And the team list receives one notification linking to the application in the admin
    And "anna@example.test" receives the email «Заявка получена»

  @EARS-5
  Scenario: A missing topic is reported and the rest of the input is kept
    Given the expert "anna@example.test" is signed in on «Подать заявку»
    When the expert chooses the format «подкаст», ticks the consent, leaves «Тема» empty and taps «Отправить заявку»
    Then nothing is sent
    And «Тема» shows what to fix and receives focus
    And the format «подкаст» is still chosen

  @EARS-5 @EARS-6
  Scenario: The application cannot be sent without the consent
    Given the expert "anna@example.test" is signed in on «Подать заявку»
    When the expert fills the required fields, leaves the consent unticked and taps «Отправить заявку»
    Then nothing is sent
    And the consent row shows «Отметьте согласие — без него заявку не отправить.»

  @EARS-8 @EARS-7
  Scenario: A server failure keeps the input and a retry creates one application
    Given the expert "anna@example.test" is signed in on «Подать заявку» with the form filled
    And the server is unavailable
    When the expert taps «Отправить заявку»
    Then the page shows «Не удалось отправить — сервер недоступен. Введённое сохранено.»
    And every value is still in the form
    When the server is available again and the expert taps «Попробовать ещё раз»
    Then the page shows «Заявка отправлена»
    And exactly one application is stored for that submission

  @EARS-11
  Scenario: A failed team notification never loses the application
    Given the expert "anna@example.test" is signed in on «Подать заявку» with the form filled
    And the mailer refuses every message
    When the expert taps «Отправить заявку»
    Then the page shows «Заявка отправлена»
    And the application is stored
    And the admin list marks it «Команда не уведомлена»

  @EARS-10
  Scenario: An expert with an application in work can send another one
    Given the expert "anna@example.test" has an application that is not closed
    When the expert opens «Подать заявку»
    Then the page shows «Ваша предыдущая заявка в работе. Новую можно отправить, если это другой проект.»
    And the form is available

  @EARS-13 @EARS-14 @EARS-15 @EARS-16 @EARS-17
  Scenario: An administrator works an application through to an outcome
    Given a platform administrator is signed in to the admin with a second factor
    And the expert "anna@example.test" has sent an application
    When the administrator opens «Заявки» and filters «Авторы»
    Then the application is first in the list with its topic and status «Новая»
    When the administrator opens it
    Then the detail shows every field sent, the consent version and the account "anna@example.test"
    When the administrator takes it into review, adds the note "Позвонить во вторник" and closes it as «Принята»
    Then the application is closed with the outcome «Принята» attributed to the administrator
    And "anna@example.test" sees no note and no outcome on «Подать заявку»

  @EARS-15
  Scenario: A closed application cannot be reopened
    Given a platform administrator is signed in to the admin with a second factor
    And an application is closed as «Отклонена»
    When the administrator moves it to «На рассмотрении»
    Then the move is refused and the application stays closed

  @EARS-17
  Scenario: The queue is refused to anyone but a platform administrator with the second factor
    Given a staff member without the role "platform_admin" is signed in to the admin
    When the staff member opens «Заявки»
    Then access is refused

  @EARS-18 @EARS-19
  Scenario: Interim partnership requests are in the same queue
    Given the interim submissions directory holds 3 partnership records
    When the operator runs the partnership import twice
    Then 3 applications of kind "partnership" are stored
    And the second run reports 3 already present
    And no team notification is sent for them

  @EARS-20
  Scenario: The applicant's personal data is erased on request
    Given a platform administrator is signed in to the admin with a second factor
    And the expert "anna@example.test" has a closed application
    When the administrator erases the applicant's personal data on it
    Then the application shows «Персональные данные стёрты» and keeps its kind, status and outcome

  @EARS-21
  Scenario: «Пока не готовы?» leads to the projects
    Given the project "Ортобиология" is the first public project of the catalog
    When a visitor opens «Подать заявку»
    Then «Пока не готовы?» shows the card of "Ортобиология" and «Посмотреть проекты →» to the catalog

  @EARS-22
  Scenario: The page and the queue work on a phone
    Given the viewport is 390 px wide
    When a visitor opens «Подать заявку» and a platform administrator opens «Заявки»
    Then neither page scrolls horizontally
    And both pass the accessibility check

  @EARS-2
  Scenario: The doctor storefront has no application page
    When a visitor opens "/apply" on doctor.school
    Then the doctor storefront not-found page is shown

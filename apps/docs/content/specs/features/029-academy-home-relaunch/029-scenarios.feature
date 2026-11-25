# Feature 029 — Academy home relaunch after the narrowing to backstage.
# Requirements: 029-requirements-en.md. Journeys run in the browser on the real stack; rules may run lower.

@feature:029 @track:academy @host:academy
Feature: 029 — Academy home relaunch after the narrowing to backstage

  Background:
    Given the platform has 3 public projects at the stage "running" and 1 at the stage "soon"
    And the platform has 12 published experts and 2 draft experts
    And the platform has 14 published organisations
    And the platform has upcoming events and published materials

  @journey @EARS-1 @EARS-2 @EARS-3 @EARS-5 @EARS-9
  Scenario: An expert finds their entry and reaches the application page
    Given a guest opens the Academy home
    Then the hero shows the line "Академия Doctor.School · закулисье платформы"
    And the "Экспертам" card reads "3 проекта в производстве · 12 экспертов"
    And the "Партнёрам" card reads "14 партнёров · прозрачная модель"
    And the sections follow in order "Кто мы", "Что мы делаем", "Ближайшие эфиры", "Новости, блог и видео", persona entries
    When the guest taps "Подать заявку" in the "Экспертам" card
    Then the guest is on "/apply"
    When the guest returns to the home and taps "Подать заявку на участие в проекте"
    Then the guest is on "/apply"

  @journey @EARS-1 @EARS-7
  Scenario: A visitor moves from the home into projects and events
    Given a guest opens the Academy home
    Then "Что мы делаем" shows the first three projects of the catalog
    And "Ближайшие эфиры" shows at most 3 event cards and a link "Все события"
    When the guest opens the first project card
    Then the guest is on that project's page
    When the guest returns and taps "Все события"
    Then the guest is on "/webinars"

  @journey @EARS-10
  Scenario: A partner reaches the team before the investor page exists
    Given the partner entries are not delivered
    And a guest opens the Academy home
    Then the "Партнёрам" card has no action
    And there is no "Инвесторам" block
    When the guest fills the partnership form with consent and submits it
    Then the form shows its success state

  @journey @EARS-8
  Scenario: A partner reaches the investor page
    Given the partner entries are delivered
    And a guest opens the Academy home
    When the guest taps "Как это работает" in the "Партнёрам" card
    Then the guest is on "/investors"
    When the guest returns and taps "Как это работает" in the "Инвесторам" block
    Then the guest is on "/investors"
    And the home has no partnership form

  @rule @EARS-5
  Scenario: A count the platform cannot give is left out
    Given the organisation count read fails
    And a guest opens the Academy home
    Then the "Партнёрам" card reads "Прозрачная модель"
    And every other section renders

  @rule @EARS-3
  Scenario: Zero projects in production drop that segment
    Given no public project is at the stage "running"
    When a guest opens the Academy home
    Then the "Экспертам" card reads "12 экспертов"

  @rule @EARS-3 @EARS-4
  Scenario: Publishing an expert changes the next read
    Given a guest has seen "12 экспертов" on the Academy home
    When a platform administrator publishes one more expert
    And the guest reloads the Academy home
    Then the "Экспертам" card reads "3 проекта в производстве · 13 экспертов"

  @rule @EARS-1 @EARS-6
  Scenario: The home carries none of the 013 landing
    When a guest opens the Academy home
    Then the page has no section "Что такое Doctor.School", "Зачем", "Выгоды" or "Форматы"
    And the page copy contains no "бесплатн"

  @rule @EARS-11
  Scenario: The home works on a phone
    Given the viewport is 390 px wide
    When a guest opens the Academy home
    Then the page has no horizontal scroll
    And the hero cards and the persona blocks are stacked
    And the page passes the accessibility check

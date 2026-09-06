Feature: 028 — Legal pages (documents and contacts)
  As a visitor of doctor.school or the Academy
  I want to read the platform's legal documents and reach a real contact
  So that I know what I am agreeing to and who is behind the platform

  Background:
    Given the documents list holds exactly one entry in slice 1: "Политика персональных данных и согласия"
    And the requisites line names "ООО «Ивекскон»" with ИНН, ОГРН and legal address, no licence number

  @EARS-1 @EARS-2
  Scenario: Doctor storefront happy path — index to document and back
    Given a visitor opens the doctor storefront's "Документы и контакты" page
    When they open "Политика персональных данных и согласия"
    Then the document page shows its title, "редакция от <дата>" and the body
    And a back link returns to the documents list
    And "Другие документы" lists the remaining published documents

  @EARS-2
  Scenario: Academy happy path — same shared content, own projection
    Given a visitor opens the Academy's "Документы и контакты" page
    When they open "Политика персональных данных и согласия"
    Then the rendered title and body match the doctor storefront's copy of the same document
    And the page is rendered in the Academy's own 008 shell

  @EARS-8 @EARS-9
  Scenario: Consent link from the 021 registration form
    Given a doctor is filling the registration form with data already entered
    When they open the consent link next to the medical-worker declaration checkbox
    Then the "consent-medical-worker" document page opens with the checkbox's exact text
    When they return to the registration form
    Then the previously entered form data is still present

  @EARS-12 @failure
  Scenario: A document with no approved content is absent
    Given "Лицензия на образовательную деятельность" has no approved content file in packages/legal-content
    When a visitor views either host's documents list
    Then no row for the licence document is rendered
    And requesting its would-be URL directly returns the not-found dataState, not a placeholder page

  @EARS-13 @failure
  Scenario: No link ever reaches the legacy site
    Given the Academy partnership lead form's personal-data consent line
    When a visitor opens its policy link
    Then the link resolves to this platform's own "Политика персональных данных и согласия" document
    And no document, footer or consent line on either host references "doctor.school/index/*"

  @EARS-6
  Scenario: Doctor documents list exits to the Academy documents page
    Given a visitor is on the doctor storefront's documents list
    When they reach the caption at the end of the list
    Then it reads "Полный набор документов платформы — на странице документов Академии."
    And it links to the Academy's documents page

  @EARS-11
  Scenario: A republished document shows the "обновлено" chip, never a version number
    Given "Политика персональных данных и согласия" is republished with a new edition date
    When a visitor views the documents list
    Then the row for that document shows the "обновлено" chip
    And no numeric version number is shown anywhere on the row or the document page

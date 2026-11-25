# 034 — Investors, slice 1 — scenarios
# Tags map every scenario to the flat EARS clauses in 034-requirements-en.md.
# User-facing spec: the representative's and the administrator's journeys run through
# Playwright BDD against apps/portal / apps/admin -> NestJS -> Postgres; intake, schema and
# queue-row assertions without a visual surface run in Vitest (apps/api e2e, packages/*).

@feature:034 @track:academy @host:academy
Feature: 034 — Investors, slice 1: the «Как это работает» page with «Обсудить проект» into the shared queue
  As a representative of an organisation and as a platform administrator
  I want to understand how participation works and send a request without an account
  So that the request lands in the one Academy queue and the team gets back to me

  Background:
    Given the personal-data consent of purpose "investor-request-personal-data" has a current version
    And an active staff account holds the role "platform_admin"

  @EARS-1 @EARS-3 @EARS-4 @EARS-6 @EARS-8 @EARS-9 @EARS-11 @journey
  Scenario: A representative reads the page and sends a request
    Given a visitor is not signed in
    When the visitor opens "/investors" on the Academy
    Then the page shows «Как это работает», «Что получает инвестор», «Как оформляются отношения» and «Следующий шаг»
    And the page shows no marketplace, no product card and no «Организация, не персона»
    And «Следующий шаг» shows «Во что инвестировать — Проекты» linking to "/projects"
    When the visitor fills «Организация» with "ООО «Партнёр А»", «ФИО» with "Иванова Анна Сергеевна" and «Рабочая почта» with "a.ivanova@partner-a.test"
    And ticks the personal-data consent
    And taps «Отправить заявку»
    Then the form is replaced by «Запрос отправлен» with «Отправить ещё одну заявку»
    And one application of kind "investor" with status "new" is stored with the consent purpose and version
    And every active platform administrator receives one notification that names neither the organisation nor the representative
    And "a.ivanova@partner-a.test" receives the email «Заявка получена» that names no organisation and no task

  @EARS-5 @journey
  Scenario: A missing organisation is reported and the rest of the input is kept
    Given a visitor is on "/investors"
    When the visitor fills «ФИО» and «Рабочая почта», ticks the consent, leaves «Организация» empty and taps «Отправить заявку»
    Then nothing is sent
    And «Организация» shows «Заполните поле» and receives focus
    And «ФИО» and «Рабочая почта» keep their values

  @EARS-4 @EARS-5 @rule
  Scenario: The request cannot be sent without the consent
    Given a visitor is on "/investors" with the required fields filled
    When the visitor leaves the consent unticked and taps «Отправить заявку»
    Then nothing is sent
    And the consent row shows «Отметьте согласие — без него заявку не отправить.»

  @EARS-5 @rule
  Scenario: A malformed work email is reported
    Given a visitor is on "/investors"
    When the visitor fills «Рабочая почта» with "a.ivanova@partner" and taps «Отправить заявку»
    Then «Рабочая почта» shows «Похоже, в адресе опечатка»

  @EARS-7 @EARS-6 @journey
  Scenario: A server failure keeps the input and a retry creates one request
    Given a visitor is on "/investors" with the form filled and the consent ticked
    And the server is unavailable
    When the visitor taps «Отправить заявку»
    Then the page shows «Не удалось отправить — сервер недоступен. Введённое сохранено.» with «Попробовать ещё раз»
    And every value is kept
    When the server is available again and the visitor taps «Попробовать ещё раз»
    Then the page shows «Запрос отправлен»
    And exactly one application of kind "investor" is stored

  @EARS-6 @rule
  Scenario: A replayed intake creates nothing new
    Given an investor request was accepted with idempotency key "K"
    When the same body is posted again with key "K"
    Then the answer is the same "201" result
    And no second application is stored

  @EARS-6 @rule
  Scenario: The same key with another body is refused
    Given an investor request was accepted with idempotency key "K"
    When a different body is posted with key "K"
    Then the intake answers "422 IDEMPOTENCY_KEY_REUSED"

  @EARS-6 @rule
  Scenario: The intake refuses a request without a bot-protection proof
    When a body is posted to "POST /v1/public/applications/investor" without a bot-protection proof
    Then the intake answers "BOT_PROTECTION_REQUIRED"
    And no application is stored

  @EARS-4 @rule
  Scenario: A stale consent version is refused
    When a body carrying a consent version tag other than the current one is posted to the investor intake
    Then the intake answers "400" with a field error on the consent

  @EARS-9 @rule
  Scenario: A failed receipt never loses the request
    Given the mailer fails
    When a valid investor request is posted
    Then the intake answers "201"
    And the request is stored with the receipt outcome "failed"

  @EARS-10 @journey
  Scenario: A platform administrator works an investor request in the shared queue
    Given an investor request from "ООО «Партнёр А»" is in the queue
    When a platform administrator opens «Заявки» and filters «Инвесторы»
    Then the request is listed with the kind «Инвестор» and the subject «ООО «Партнёр А»»
    When the administrator opens it
    Then the detail shows «Организация», «ФИО», «Рабочая почта» and «Задача» with their values and the consent purpose and version
    When the administrator moves it to «На рассмотрении» and adds a note
    Then the status and the note are stored under the administrator

  @EARS-12 @rule
  Scenario: An investor request is erased at term
    Given an investor request closed one year ago
    When the daily purge runs
    Then its contact and subject line are erased and the payload is the tombstone
    And its kind, status, outcome and times are kept

  @EARS-2 @journey
  Scenario: The doctor storefront has no investor page
    When a visitor opens "/investors" on the doctor storefront
    Then the doctor storefront's not-found page is shown

  @EARS-13 @journey
  Scenario: The page works on a phone
    Given the viewport is 390 px wide
    When a visitor opens "/investors", submits the empty form and then sends a valid request
    Then the page, the form with its errors and the confirmation have no horizontal page scroll
    And each of them passes the playwright-axe gate

# 007 — the operator journey in the Refine admin app, translated from
# 007-scenarios.feature to the browser surface via playwright-bdd. The api-level
# guarantees (single source of truth, one audit row per transition, the 006 player
# instantiation) are asserted in the apps/api Vitest e2e; HERE we drive exactly what
# the operator sees and does in the running admin UI on the live dev stand — the
# required user-facing deliverable (requirements Verification, `all` row).

Feature: Minimal event admin — one operator creates, streams, runs, and archives a webinar

  @EARS-1 @EARS-3 @EARS-4 @EARS-5 @EARS-6 @happy
  Scenario: One operator runs a webinar end to end, from creation to archive
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    Then the event is shown in the "draft" state
    And only the "publish" lifecycle action is offered
    When the operator configures the stream with provider "rutube"
    And the operator publishes the event
    Then the event is shown in the "published" state
    When the operator opens the room
    Then the event is shown in the "live" state
    When the operator closes the room
    Then the event is shown in the "ended" state
    When the operator archives the event
    Then the event is shown in the "archived" state
    And no lifecycle action is offered

  @EARS-7 @failure
  Scenario: The admin UI offers only the transitions valid from the current state
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    Then only the "publish" lifecycle action is offered
    And no invalid transition action is offered from draft

  @EARS-3 @failure
  Scenario: The stream provider is a closed enum — nothing outside rutube|youtube can be chosen
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    Then the stream provider choices are exactly rutube and youtube

  @EARS-10 @happy
  Scenario: Absolute admin times render in МСК regardless of the operator's timezone
    Given a platform_admin operator in the admin app
    When the operator creates a draft event at "2026-07-17T19:00" МСК with a program PDF
    Then the event air time renders as "19:00" МСК in the admin list
    And no untranslated catalog key is visible on the surface

  @nav @happy
  Scenario: Every inner admin screen offers one-click return to the events list
    Given a platform_admin operator in the admin app
    When the operator opens the create-event screen
    Then a one-click link returns the operator to the events list
    When the operator creates a draft event with a program PDF
    Then a one-click link returns the operator to the events list

  @EARS-8 @failure
  Scenario: A non-admin caller cannot reach the admin surface
    Given a doctor_guest caller with a session
    When the caller opens the events page
    Then the caller is bounced to the login screen

  @EARS-8 @auth-guard @happy
  Scenario: An already-authenticated admin visiting the login screen is redirected to the events list
    Given a platform_admin operator in the admin app
    When the operator opens the login screen
    Then the operator is redirected to the events list without a login form

  @EARS-10 @validation @failure
  Scenario: The create form refuses invalid input with rendered RU validation errors
    Given a platform_admin operator in the admin app
    When the operator submits the create-event form with no fields filled
    Then the form shows the RU validation error "Обязательное поле."
    And the form shows the RU validation error "Укажите дату и время (МСК)."
    And the operator stays on the create-event screen
    When the operator enters "0" as the duration
    Then the form shows the RU validation error "Длительность — целое число минут, не меньше 1."
    When the operator adds a speaker and leaves the name empty
    Then the form shows the RU validation error "Укажите имя спикера или удалите строку."
    When the operator attaches a non-PDF program file
    Then the form shows the RU validation error "Файл программы должен быть в формате PDF."

  @EARS-3 @validation @failure
  Scenario: A URL pasted as the stream embed reference is refused client-side with an RU error
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    And the operator saves the stream with embed reference "https://rutube.ru/video/abc/"
    Then the form shows the RU validation error "Укажите идентификатор потока у провайдера, а не ссылку (URL)."
    And the stream configuration is not saved

  @EARS-3 @validation @failure
  Scenario: A garbage stream embed id is refused with a provider-specific RU error (Stage-B «ччсапп»)
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    And the operator saves the stream with embed reference "ччсапп"
    Then the form shows the RU validation error "Неверный идентификатор Rutube"
    And the stream configuration is not saved

  @EARS-3 @validation @happy
  Scenario: A realistic provider-scoped embed id is accepted for each provider
    Given a platform_admin operator in the admin app
    When the operator creates a draft event with a program PDF
    And the operator configures the stream with provider "youtube"
    And the operator configures the stream with provider "rutube"

  @EARS-8 @validation @failure
  Scenario: The login form refuses an empty submit with rendered RU errors, never native bubbles
    Given an anonymous visitor on the admin login screen
    Then native browser validation is suppressed on the login form
    When the visitor submits the login form with no fields filled
    Then the form shows the RU validation error "Укажите корректный адрес электронной почты."
    And the form shows the RU validation error "Пароль — не короче 8 символов."
    And the visitor stays on the login screen

  @EARS-10 @validation @happy
  Scenario: A corrected create form clears the errors and creates the event
    Given a platform_admin operator in the admin app
    When the operator submits the create-event form with no fields filled
    Then the operator stays on the create-event screen
    When the operator creates a draft event with a program PDF
    Then the event is shown in the "draft" state

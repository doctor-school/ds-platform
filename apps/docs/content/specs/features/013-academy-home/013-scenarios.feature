# 013 — Academy home and private partnership form
# Tags map to flat EARS ids in 013-requirements-en.md.

Feature: A visitor submits the Academy partnership form privately

  Background:
    Given the approved Academy home is available at "/"
    And the private portal volume is writable

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @regression
  Scenario: The shipped Academy home remains approved
    When an unauthenticated visitor opens "/"
    Then the response status is 200
    And the approved Academy composition and external destinations remain unchanged

  @EARS-5 @reject
  Scenario: Invalid form input is rejected without persistence
    When the visitor submits missing required fields or an invalid combined contact
    Then accessible inline errors are shown for invalid fields
    And FormErrorSummary below submit receives focus
    And no JSON record is created

  @EARS-5 @accept
  Scenario: The enabled form has the approved controls
    When the visitor reaches the partnership form
    Then the combined contact field is labelled "Email или Telegram"
    And roles appear in order "Эксперт", "Партнёр", "Участник подкаста", "Соавтор направления", "Компания"
    And required consent links to "https://doctor.school/index/privacy-pay"

  @EARS-6 @accept @idempotency
  Scenario: A valid retry creates exactly one private record
    Given the visitor enters valid required values and accepts consent
    When the visitor submits the same idempotency key twice
    Then exactly one private JSON record exists with id, accepted time, fields, and immutable consent evidence
    And the form is replaced by "Спасибо! Заявка сохранена."

  @EARS-7 @write-failure
  Scenario: A write failure keeps values and does not claim success
    Given the visitor enters valid required values
    And the private writer fails
    When the visitor submits the form
    Then entered values remain available
    And no partial record exists
    And "Не удалось сохранить заявку. Попробуйте ещё раз." appears above submit
    And no success state is shown

  @EARS-6 @privacy
  Scenario: Visitors cannot read, list, log, or egress submissions
    When a visitor attempts to read or list submitted records
    Then no public read or list surface exists
    And raw submitted values are absent from application logs
    And the submission flow makes no outbound egress request

  @EARS-8 @responsive @a11y
  Scenario Outline: The enabled form is accessible in every presentation
    Given the viewport is "<viewport>"
    And the theme is "<theme>"
    When the visitor submits valid values and the form is pending
    Then a second submission is prevented
    And keyboard focus remains visible and usable
    And there is no horizontal overflow
    And axe reports no serious or critical violations

    Examples:
      | viewport | theme |
      | desktop | light |
      | desktop | dark |
      | mobile | light |
      | mobile | dark |

# INTERIM STATIC STUB — 013 Academy home and private partnership form
# Tags map to flat EARS ids in 013-requirements-en.md.
#
# NOT the Feature 013 contract. These scenarios cover the temporary demo stub
# live at / since release-2026.08.16-2 (Issues #1311 / #1312). The canonical
# Feature 013 product contract is 013-product.md, US-1…US-12. Superseded by
# #1324; dismantled by #1323.

Feature: A visitor submits the Academy partnership form privately

  Background:
    Given the portal uses Academy source commit "7330e4d8a99bdeca73285e2b4eabf09d7021788c"
    And the approved Academy home is available at "/"
    And the private portal volume is writable

  @EARS-1 @EARS-2 @happy @regression
  Scenario: A guest opens the exact approved page
    When an unauthenticated visitor opens "/"
    Then the response status is 200
    And the visitor is not redirected to "/webinars"
    And the sections appear in the order hero, What, People, Events, Why, Projects, partner value, formats, form, footer
    And People shows the Project block before exactly six supplied portraits
    And no dynamic content request is made
    And no invented project metric appears

  @EARS-2 @happy @regression
  Scenario: Project and Events show the same approved rows
    When the visitor inspects Project and Events
    Then both blocks show "Синергизм вместо конкуренции в фарме (возможен ли?)"
    And both blocks show "B2B — стейкхолдеры реальных решений"
    And both B2B links equal "https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd"
    And the privacy link equals "https://doctor.school/index/privacy-pay"

  @EARS-3 @boundary @regression
  Scenario: The pre-follow-up partnership preview cannot submit
    Given the EARS-5 follow-up is not delivered
    When the visitor reaches "Обсудим партнёрство?"
    Then "Демо: данные не отправляются" is visible
    And the partnership fieldset is disabled
    And the "Обсудить партнёрство" button is disabled
    When the visitor uses keyboard and pointer interaction around the preview
    Then no form network request is sent
    And no values are persisted

  @EARS-4 @responsive @a11y @regression
  Scenario Outline: The page remains usable at every approved presentation
    Given the viewport is "<viewport>"
    And the theme is "<theme>"
    When the visitor reads the complete page
    Then the approved composition remains visible without horizontal overflow
    And keyboard focus is visible on enabled controls
    And axe reports no serious or critical violations

    Examples:
      | viewport | theme |
      | desktop  | light |
      | desktop  | dark  |
      | mobile   | light |
      | mobile   | dark  |

  @EARS-5 @reject
  Scenario Outline: Invalid form input is rejected without persistence
    When the visitor submits otherwise valid values with invalid combined contact "<invalid contact>"
    Then accessible inline errors are shown for invalid fields
    And FormErrorSummary below submit receives focus
    And no JSON record is created

    Examples:
      | invalid contact |
      | name@           |
      | username        |
      | @abcd           |
      | @bad-name       |

  @EARS-5 @reject
  Scenario: Missing required name, role, or consent is rejected without persistence
    When the visitor submits otherwise valid values without a required name, role, or consent
    Then accessible inline errors are shown for invalid fields
    And FormErrorSummary below submit receives focus
    And no JSON record is created

  @EARS-5 @accept
  Scenario: The enabled form has the approved controls
    When the visitor reaches the partnership form
    Then the combined contact field is labelled "Email или Telegram"
    And its placeholder is "name@company.ru или @username"
    And roles appear in order "Эксперт", "Партнёр", "Участник подкаста", "Соавтор направления", "Компания"
    And required consent links to "https://doctor.school/index/privacy-pay"

  @EARS-5 @accept
  Scenario Outline: Email and Telegram contacts share one validated field
    Given the visitor enters contact "<contact>"
    When the visitor submits otherwise valid values and accepts consent
    Then the shared client and server schema accepts the contact

    Examples:
      | contact            |
      | partner@example.ru |
      | @username          |

  @EARS-6 @accept @idempotency
  Scenario: A valid retry creates exactly one private record
    Given the visitor enters valid required values and accepts consent
    When the visitor submits the same idempotency key twice
    Then exactly one private JSON record exists with id, accepted time, fields, and immutable consent evidence
    And consent evidence contains purpose, version tag, exact text, text SHA-256, acceptance time, and policy URL
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

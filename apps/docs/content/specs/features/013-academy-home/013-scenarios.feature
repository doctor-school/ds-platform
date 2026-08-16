# 013 — Static public Academy home
# Tags map to the flat EARS ids in 013-requirements-en.md.

Feature: A visitor opens the approved static Academy home

  Background:
    Given the portal uses Academy source commit "7330e4d8a99bdeca73285e2b4eabf09d7021788c"
    And the partnership form is deliberately disabled for this release

  @EARS-1 @EARS-2 @happy
  Scenario: A guest opens the exact approved page
    When an unauthenticated visitor opens "/"
    Then the response status is 200
    And the visitor is not redirected to "/webinars"
    And the sections appear in the order hero, What, People, Events, Why, Projects, partner value, formats, disabled form, footer
    And People shows the Project block before exactly six supplied portraits
    And no dynamic content request is made
    And no invented project metric appears

  @EARS-2 @happy
  Scenario: Project and Events show the same approved rows
    When the visitor inspects Project and Events
    Then both blocks show "Синергизм вместо конкуренции в фарме (возможен ли?)"
    And both blocks show "B2B — стейкхолдеры реальных решений"
    And both B2B links equal "https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd"
    And the privacy link equals "https://doctor.school/index/privacy-pay"

  @EARS-3 @boundary
  Scenario: The partnership preview cannot submit
    When the visitor reaches "Обсудим партнёрство?"
    Then "Демо: данные не отправляются" is visible
    And the partnership fieldset is disabled
    And the "Обсудить партнёрство" button is disabled
    When the visitor uses keyboard and pointer interaction around the preview
    Then no form network request is sent
    And no values are persisted

  @EARS-4 @responsive @a11y
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

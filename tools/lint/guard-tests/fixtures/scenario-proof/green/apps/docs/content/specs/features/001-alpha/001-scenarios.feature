@host:academy
Feature: Alpha

  Background:
    Given the alpha page is open

  @EARS-1 @happy
  Scenario: bound scenario
    When I press "Go"
    Then I see 3 items

  @EARS-1
  Scenario Outline: bound outline
    Then I see <count> items

    Examples:
      | count |
      | 2     |

  @EARS-2 @proof:unit
  Scenario: unit proof
    When something unbound happens

  @EARS-3 @proof:api
  Scenario: api proof
    When something unbound happens

  @EARS-4 @proof:unit @proof:app-e2e
  Scenario: app-e2e proof
    When something unbound happens

  @EARS-3 @proof:api
  Scenario: bound and tagged
    When I press "Stop"

  @EARS-5
  Scenario: listed debt
    When something unbound happens

  @EARS-5
  Scenario: repeated title
    When something unbound happens

  @EARS-5
  Scenario: repeated title
    When something else unbound happens

  @EARS-5
  Scenario: new tracked debt
    When something unbound happens

@host:academy
Feature: Alpha

  @EARS-1 @journey @proof:unit
  Scenario: journey with proof
    When something unbound happens

  @EARS-1 @journey
  Scenario: portal-only journey
    Then the portal lists the item

  @EARS-1 @journey @quarantine(#7)
  Scenario: quarantined journey
    When I press "Go"

  @EARS-1 @journey @rule
  Scenario: both classes
    When I press "Go"

  @EARS-1 @proof:unit
  Scenario: unclassified with proof
    When something unbound happens

  @EARS-1 @journey
  Scenario: staging journey
    When I press "Go"

  @EARS-1 @rule
  Scenario: portal rule
    Then the portal lists the item

  @EARS-1
  Scenario: legacy unclassified
    When I press "Go"

  @EARS-1
  Scenario: new unclassified
    When I press "Go"

  @EARS-1 @rule
  Scenario: new tagged rule
    When I press "Go"

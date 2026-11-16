@host:admin
Feature: Alpha

  @EARS-1 @journey
  Scenario: excluded journey
    When I press "Go"

  @EARS-1 @journey @wave-x
  Scenario: wave journey
    When I press "Go"

  @EARS-1 @journey
  Scenario Outline: outline partly selected
    When I <action>

    @wave-x
    Examples:
      | action     |
      | press "Go" |

    Examples:
      | action |
      | dance  |

  @wave-x
  Rule: a tagged rule

    @EARS-1 @journey
    Scenario: rule-tagged journey
      When I press "Go"

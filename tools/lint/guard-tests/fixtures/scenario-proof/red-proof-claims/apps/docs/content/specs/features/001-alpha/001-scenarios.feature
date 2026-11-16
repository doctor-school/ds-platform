@host:academy
Feature: Alpha

  @EARS-1 @rule @proof:browser
  Scenario: unknown level
    When something unbound happens

  @rule @proof:unit
  Scenario: proof without ears
    When something unbound happens

  @EARS-2 @rule @proof:unit
  Scenario: agnostic only
    When something unbound happens

  @EARS-3 @rule @proof:api
  Scenario: wrong level
    When something unbound happens

  @EARS-4 @rule @proof:unit
  Scenario: other spec
    When something unbound happens

  @EARS-5 @rule @proof:unit
  Scenario: harness only
    When something unbound happens

  @EARS-6 @rule @proof:unit
  Scenario: two-spec file
    When something unbound happens

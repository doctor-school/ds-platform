@host:academy
Feature: Alpha

  Background:
    Given the alpha page is open

  @EARS-1 @journey
  Scenario: split journey
    When the admin approves the item

  @EARS-1 @rule
  Scenario: split rule
    When the admin approves the item

  @EARS-1 @journey
  Scenario: scoped journey
    When the scoped step runs

  @EARS-1 @journey
  Scenario: staging journey
    When I press "Go"

Feature: Shell journey

  @EARS-2 @happy
  Scenario: A doctor uses the shell nav
    Given a signed-in doctor on the discovery front-door
    When the doctor activates the header nav item
    Then the shell lands on "/account/events" showing "Мои события"
    And the visitor never lands on /
    And the filter panel opens as a sheet

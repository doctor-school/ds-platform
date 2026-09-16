Feature: 008 Portal shell

  @EARS-2 @happy
  Scenario: The portal navigates from the header
    Given a signed-in doctor
    When the doctor activates the header nav item
    Then the portal navigates to "/account/events"

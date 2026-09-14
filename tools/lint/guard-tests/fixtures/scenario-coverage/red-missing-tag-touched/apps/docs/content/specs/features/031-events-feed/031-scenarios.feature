Feature: 031 Events feed

  @EARS-1 @happy
  Scenario: A doctor sees the upcoming events
    Given a signed-in doctor
    When the doctor opens the feed
    Then the shell lands on "/account/events" showing "Мои события"

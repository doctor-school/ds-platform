Feature: 032 Webinar room

  @EARS-1 @quarantine
  Scenario: A doctor joins the room
    Given a signed-in doctor
    When the doctor joins the live webinar
    Then the shell lands on "/account/webinars/live" showing "Эфир"

  @EARS-2 @quarantine(#9001)
  Scenario: The stream drops
    Given a doctor in the room
    When the stream drops
    Then the room lands on "/account/webinars/live" showing "Переподключаемся"

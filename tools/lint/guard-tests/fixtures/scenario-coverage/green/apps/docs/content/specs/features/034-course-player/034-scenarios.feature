# 034 — the Feature-level host tag of the C6 suite (§6.1) sits above `Feature:`.
@host:both
Feature: 034 Course player

  @EARS-1 @happy
  Scenario: A doctor plays the recording
    Given a signed-in doctor
    When the doctor opens a course
    Then the shell lands on "/account/courses/1" showing "Запись"

  @EARS-3 @happy
  Scenario: A doctor resumes where they stopped
    Given a doctor with a partly watched course
    When the doctor reopens the course
    Then the player lands on "/account/courses/1" showing "Продолжить"

  @EARS-3 @flaky @quarantine(#9002)
  Scenario: The resume position survives a reload
    Given a doctor with a partly watched course
    When the doctor reloads the player
    Then the player lands on "/account/courses/1" showing "Продолжить"

Feature: 033 Legacy feed

  @EARS-1 @happy
  Scenario: A doctor reads the archive
    Given a signed-in doctor
    When the doctor opens the legacy feed
    Then the shell lands on "/account/archive" showing "Архив"

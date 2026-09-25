@feature:046 @track:doctor
Feature: 046 — Congress abstracts and talk submissions
  As a congress author, a congress partner and a platform administrator
  I want abstracts and talk applications to ride on the congress registration
  So that every submission belongs to a registered participant, authors can correct them until the deadline, and the partner can work the submissions without seeing the participant list

  Background:
    Given the congress event is published and the 044 intake is live behind the same-origin "/api" proxy
    And the current time is inside the 044 registration window
    And the submission window is configured from 2026-10-01T00:00+03:00 to 2026-12-01T00:00+03:00
    And the abstract and talk field sets are the base set recorded in 046-design.md

  @EARS-1 @EARS-2 @EARS-5 @EARS-7 @EARS-11
  Scenario: Participant with one abstract
    Given no Doctor.School account exists for "author@example.org"
    And the current time is inside the submission window
    When a participant submits the congress form for "author@example.org" with one abstract carrying a title, a listed topic, one author, the four text sections within their limits and three keywords
    Then the 044 cascade creates the account, the consent record and the registration
    And exactly one abstract submission row is linked to that registration
    And the response is exactly {"status":"accepted"}
    And one email is sent: the 044 confirmation with a block listing the abstract and an edit link

  @EARS-1 @EARS-3 @EARS-4 @EARS-5
  Scenario: Participant with a talk application
    Given the current time is inside the submission window
    When a participant submits the congress form with one talk carrying a listed topic, a title and two co-authors, one flagged as presenting, typed as " иван  петров "
    Then exactly one talk submission row is linked to the participant's registration
    And the co-author's name is stored as "Иван Петров"

  @EARS-5 @EARS-6 @EARS-23
  Scenario: Two abstracts in one submission, then the same form sent again
    Given the current time is inside the submission window
    When a participant adds two abstract sections on the congress-site form and sends it as one request carrying two distinct client ids
    And the participant sends the same form again with the first abstract's results section changed
    Then the registration carries exactly two abstract submissions
    And the first abstract's stored results section is the one from the first request

  @EARS-3
  Scenario: Talk without a presenting co-author is refused
    Given the current time is inside the submission window
    When a participant submits the congress form with a talk whose co-authors are all unflagged
    Then the request is refused as invalid
    And no account, registration, submission or email is created

  @EARS-13 @EARS-14 @EARS-11 @EARS-15 @EARS-25
  Scenario: Edit and add through the email link
    Given a registration with one abstract and a submissions email carrying the edit link
    And the current time is inside the submission window
    When the author opens the edit page from the link and replaces the abstract's results section
    And adds one talk application
    Then the abstract's results section is the new text and its changed instant moves
    And the registration carries the abstract and the talk
    And both changes are recorded with the registration's account as the actor and the channel "edit-link"
    And an email with the updated list and the same edit link is sent
    And no platform session is created

  @EARS-11 @EARS-12
  Scenario: Submissions email fails, the submission survives
    Given the current time is inside the submission window
    And the mail provider rejects every send
    When a registered participant submits the congress form with one new talk
    Then the talk submission row is stored and the response is exactly {"status":"accepted"}
    And the registration's submissions-mail outcome is recorded as failed with its timestamp
    When the mail provider recovers and the author saves an edit through the link
    Then the submissions email is sent and the outcome is recorded as sent

  @EARS-13
  Scenario: A forged or foreign edit token is refused generically
    When the edit endpoint is called with a token whose signature does not match
    And the edit endpoint is called with a well-formed token for a registration that does not exist
    Then both calls receive the same generic refusal

  @EARS-9 @EARS-14 @EARS-24
  Scenario: Submission window closed
    Given the current time is after 2026-12-01T00:00+03:00 and inside the 044 registration window
    When a participant submits the congress form with one abstract
    Then the request is refused with the state "submissions-closed"
    And no account, registration, submission or email is created
    When a participant submits the congress form without submissions
    Then the response is exactly {"status":"accepted"} and the registration is created per 044
    When an author opens the edit page from an earlier email
    Then their submissions are shown read-only
    And a replace through the link is refused with the state "submissions-closed"

  @EARS-8 @EARS-10
  Scenario: The deadline moves in settings without a release
    Given CONGRESS_SUBMISSION_WINDOW_CLOSES_AT is changed to 2026-12-15T00:00+03:00 on the deployment
    When the congress site loads the submission-form endpoint on 2026-12-05
    Then the window state is "open" with the new closing instant
    And the topic list and field limits equal the server's schema declaration

  @EARS-16 @EARS-17 @EARS-18 @EARS-19 @EARS-20 @EARS-21 @EARS-22
  Scenario: Congress partner searches the submissions registry
    Given a principal holding only "congress-partner" bound to the congress event
    When the partner signs in to the admin
    Then the navigation shows the single "Заявки" item
    When the partner filters by kind "abstract" and searches abstracts by a word of a title
    And searches speakers by a presenting co-author's surname
    Then only the matching submissions of this congress are listed, sorted on the server
    When the partner opens a submission card
    Then the card shows the full content, the authors and the submitter's name, email and contact phone
    And no create, edit or delete control is present

  @EARS-17
  Scenario: Congress partner is refused outside the submissions registry
    Given a principal holding only "congress-partner" bound to the congress event
    When the partner requests the 044 participant roster, another event's submissions or any mutation
    Then every request is refused by the server

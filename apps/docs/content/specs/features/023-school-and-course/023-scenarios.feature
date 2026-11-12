# 023 — The school and the course — scenarios
# Tags map every scenario to the flat EARS clauses in 023-requirements-en.md.
# This is a user-facing spec: doctor, guest and admin journeys run through Playwright BDD
# against apps/doctor / apps/admin -> NestJS -> Postgres. Read-model and setting assertions
# without a visual surface run in Vitest (packages/learning, apps/api e2e).

@feature:023 @track:doctor @host:doctor
Feature: 023 — A doctor chooses a school and reads a course before walking its path
  As a doctor on doctor.school
  I want a school screen that shows who teaches, which courses lead where and what graduates say
  So that I choose a school as I would choose a teacher and know what each course gives me

  Background:
    Given the published school "ortho" "Школа ортобиологии" of the direction "Ортобиология" led by an expert
    And the school has the published courses "ortho-basic" with three modules and "ortho-short" with one module
    And the course "ortho-basic" leads to the document "certificate-nmo"

  @EARS-1 @EARS-3 @EARS-4 @EARS-5 @EARS-23 @school-doctor-journeys
  Scenario: A doctor opens a school and goes from a course card to the course path
    Given a doctor is signed in on the doctor storefront
    When the doctor opens "/schools/ortho"
    Then the header reads «Школа ортобиологии», its description and «О школе» facts, with «2 курса» and the count of their lessons
    And the courses are shown as two cards in school order
    And no text on the page contains «бесплатно», «проект» or «серий»
    When the doctor opens the card "ortho-basic"
    Then the 024 course path of "ortho-basic" is shown

  @EARS-5 @school-doctor-journeys
  Scenario: A school with more than six courses shows the courses in progress first
    Given the school "ortho" has 22 published courses
    And a signed-in doctor has started 2 of them
    When the doctor opens "/schools/ortho"
    Then «Вы учитесь» shows 2 course cards
    And the remaining courses are rows with «Найти курс» and «Показать ещё 10»
    When the doctor searches «zzz»
    Then the courses section says no course of this school matches «zzz»

  @EARS-6 @EARS-7 @EARS-23 @school-guest-journeys
  Scenario: A school without a published course is «скоро» and a guest asks to see it in the feed
    Given the published school "cardio" has no published course and the «скоро» note "Первые курсы появятся осенью"
    And a visitor who is not signed in
    When the visitor opens "/schools/cardio"
    Then the header shows «Скоро» and the courses section shows «Школа готовится» with "Первые курсы появятся осенью"
    When the visitor uses the interest capture and registers
    Then the doctor lands on "/schools/cardio" showing «Школа готовится»
    And the specialty of the direction of "cardio" is among the doctor's specialties

  @EARS-8 @school-guest-journeys
  Scenario: A guest reads the school and the gate says what needs an account
    Given a visitor who is not signed in
    When the visitor opens "/schools/ortho"
    Then every section of the school is readable
    And the courses section shows the gate that starting a lesson needs registration with a return to this place

  @EARS-9 @EARS-10 @school-doctor-journeys
  Scenario: A doctor without confirmed documents sees the verification band and the waiting certificate
    Given a doctor is signed in whose documents are not confirmed
    And the doctor has done every module of "ortho-basic"
    When the doctor opens "/schools/ortho"
    Then the verification band over the courses leads to the document upload in the doctor's account
    And the document block says the certificate waits for document verification

  @EARS-11 @EARS-13 @school-doctor-journeys
  Scenario: The course header states the rules in words and never the preset's name
    Given the course "ortho-basic" has the preset «Открытый курс» applied
    And a doctor is signed in on the doctor storefront
    When the doctor opens "/courses/ortho-basic"
    Then the header shows the school, the leading expert, the academic hours, the lesson count and the document with its prerequisites
    And the header says the certificate needs the whole course
    And no text on the page contains «Открытый курс»
    When the doctor opens a lesson of the third module directly
    Then the lesson is open and the earlier lessons stay not done on the path

  @EARS-12 @school-doctor-journeys
  Scenario: A single-module course has no module level
    Given a doctor is signed in on the doctor storefront
    When the doctor opens "/courses/ortho-short"
    Then the path and the «Модули и уроки» outline show its lessons without a module section
    And no text on the page contains «модуль 1 из 1»

  @EARS-2 @EARS-14
  Scenario Outline: The module reward decides what a finished module gives
    Given the first module of "ortho-basic" has the reward "<reward>"
    When a doctor's first module of "ortho-basic" turns done
    Then feature 025 has received <facts> "module.completed" fact for it
    And <documents> module document request is sent to feature 038

    Examples:
      | reward   | facts | documents |
      | points   | one   | no        |
      | document | no    | one       |
      | both     | one   | one       |

  @EARS-14
  Scenario: The course certificate is requested for the whole course whatever the module rewards
    Given every module of "ortho-basic" has the reward "points"
    When a doctor's course "ortho-basic" turns done
    Then one course certificate request is sent to feature 038
    When the doctor's course turns done again after a rule change
    Then no second request is sent

  @EARS-18 @EARS-19 @EARS-20 @school-doctor-journeys
  Scenario: A graduate's review appears only after staff publish it
    Given a doctor is signed in who has done "ortho-basic"
    When the doctor leaves a review of "ortho-basic" with 5 stars and "Разбор ПКС — лучший формат"
    Then the reviews section of "/schools/ortho" does not show it
    When a staff member publishes the review on the moderation screen
    Then the reviews section shows it with the doctor's specialty and city and without the name
    And one change-audit row names the staff member

  @EARS-18
  Scenario: A doctor who has not finished a course cannot leave a review
    Given a doctor is signed in who has not done any course of "ortho"
    When the doctor's client submits a review of "ortho-basic"
    Then it is refused with "REVIEW_NOT_GRADUATE" and nothing is stored

  @EARS-20
  Scenario: A failed reviews read leaves the rest of the school working
    Given the reviews read of "ortho" fails
    When a doctor opens "/schools/ortho"
    Then the reviews section shows an alert with «Повторить»
    And the course cards are shown

  @EARS-16 @school-doctor-journeys
  Scenario: Mentoring opens after the whole course
    Given the school "ortho" has a mentoring offer
    And a doctor is signed in who has not done any course of "ortho"
    When the doctor opens "/schools/ortho"
    Then the mentoring section says mentoring opens after the whole course
    Given the doctor has done "ortho-basic"
    When the doctor chooses «Хочу к наставнику»
    Then the request is confirmed on the screen
    And the school editor in the admin lists the doctor's mentoring request

  @EARS-15 @EARS-17
  Scenario: The school shows its club events and its community
    Given the first module of "ortho-basic" has its club on a scheduled event
    And the school "ortho" has a community link
    When a doctor opens "/schools/ortho"
    Then the events section shows the club event card
    And the community section links to the community

  @EARS-21
  Scenario: The lesson of the day opens inside its course
    Given the feed's lesson of the day is lesson 2 of "ortho-basic"
    When a doctor opens it from the feed
    Then the 024 step screen of its first step is shown with the course title linking back to the path

  @EARS-22
  Scenario: A partner's course is labelled
    Given the course "ortho-basic" carries the partner organisation "Партнёр А"
    When a doctor opens "/schools/ortho"
    Then the card "ortho-basic" carries the partner mark with "Партнёр А"

  @EARS-26 @EARS-27 @EARS-28 @school-admin-journeys
  Scenario: Staff build a school, a course and its modules and cannot publish an empty course
    Given a staff member with content editing is signed in to the admin with a second factor
    When the staff member creates the school "neuro" of the direction "Неврология" with a leading expert
    And creates the course "neuro-basic" in it with two modules
    And sets the club of the first module to a scheduled event and its reward to "both"
    And publishes "neuro-basic"
    Then the publish is refused naming the missing published lesson
    And the rules of the first module show "module.reward" as «Задано здесь»
    When the staff member creates a second school for the same expert in "Неврология"
    Then it is refused with a field error

  @EARS-28
  Scenario: The reward of a published course changes only through the rules change dialog
    Given a staff member with content editing but without «Редактор правил обучения»
    When the staff member changes the reward of a module of "ortho-basic"
    Then the change is refused and nothing changes

  @EARS-25 @school-phone
  Scenario: The school screen and the course header work on a phone and pass axe
    Given a doctor is signed in on the doctor storefront at a 390 px viewport
    When the doctor opens "/schools/ortho" and "/courses/ortho-basic"
    Then no page scrolls horizontally and every control is keyboard-reachable
    And each page passes the playwright-axe gate

  @EARS-24
  Scenario: The Academy has no school screen
    When a visitor opens "/schools/ortho" on the Academy host
    Then the Academy not-found page is shown

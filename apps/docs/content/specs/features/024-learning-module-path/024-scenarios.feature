# 024 — The course path, lesson steps and the rules constructor — scenarios
# Tags map every scenario to the flat EARS clauses in 024-requirements-en.md.
# This is a user-facing spec: doctor, guest and admin journeys run through Playwright BDD
# against apps/doctor / apps/admin -> NestJS -> Postgres. Catalog, resolver and evaluator
# assertions without a visual surface run in Vitest (packages/learning, apps/api e2e).

@feature:024 @track:doctor @host:doctor
Feature: 024 — A doctor walks one course path of steps whose rules are settings
  As a doctor on doctor.school and in the mobile app
  I want one continuous path through the course, one screen per step, and rules I can read
  So that I always know where I am and what counts, and nothing I did is lost when rules change

  Background:
    Given the published course "ortho-basic" titled "Ортобиология. Базовый" with one module "Суставы и хрящ"
    And the course has the preset «Путь (Duolingo)» applied
    And lesson 1 of the module has the steps video "Тест Лахмана" of 12 minutes, download "Сроки восстановления" of 3 minutes and the exit test "Тест по уроку 1"
    And lesson 2 of the module has the steps video "Разрыв ПКС у бегуньи" of 10 minutes and the exit test "Тест по уроку 2"

  @EARS-1 @EARS-2 @EARS-3 @EARS-5 @EARS-6 @EARS-7 @EARS-9 @EARS-11 @EARS-13 @EARS-14 @EARS-26 @learning-doctor-journeys
  Scenario: A doctor sees the course as one path of steps with computed states
    Given a doctor is signed in on the doctor storefront
    When the doctor opens "/courses/ortho-basic"
    Then the path shows the section "Суставы и хрящ" with lesson 1 of 3 steps and lesson 2 of 2 steps, a club node and the document node
    And the step "Тест Лахмана" is marked «Вы здесь» with «Продолжить»
    And the step "Разрыв ПКС у бегуньи" is locked with «Шаг откроется, когда будут пройдены предыдущие.»
    And no text on the page contains «бесплатно» or «проект»

  @EARS-10 @EARS-11 @EARS-12 @EARS-15 @EARS-16 @EARS-17 @EARS-18 @learning-doctor-journeys
  Scenario: A doctor completes a lesson step by step and the next lesson opens
    Given a doctor is signed in on the doctor storefront
    When the doctor opens the step "Тест Лахмана"
    Then the step screen reads «Урок 1 · 3 шага» and «Шаг засчитывается, когда видео просмотрено на 100 %»
    And the lesson completion line reads «Урок засчитывается, когда пройдены все шаги и тест сдан не ниже 80 %»
    When the doctor watches the video to the end
    And opens the download "Сроки восстановления" with «Скачать»
    And answers "Тест по уроку 1" with a score of 90 %
    Then the result reads «Тест сдан: 90 % при пороге 80 %»
    And lesson 1 is done on the path
    And the step "Разрыв ПКС у бегуньи" is marked «Вы здесь»
    And feature 025 has received one "lesson.completed" fact for lesson 1 with mode "online"

  @EARS-18 @EARS-19 @learning-doctor-journeys
  Scenario: A failed test keeps the steps done and offers the corrective material
    Given a doctor is signed in on the doctor storefront
    And the doctor has done the video and the download of lesson 1
    And question 2 of "Тест по уроку 1" carries the corrective material "Разбор пациента"
    When the doctor answers "Тест по уроку 1" with a score of 60 %, getting question 2 wrong
    Then the result reads «Тест не сдан: 60 % при пороге 80 %. Пройденные шаги сохранены.»
    And «Разбор по этой ошибке» with «Посмотреть разбор» is offered for question 2
    And lesson 1 is not done on the path
    And feature 025 has received no fact for lesson 1

  @EARS-8 @EARS-18
  Scenario: Attempts beyond the limit are refused with the next opening instant
    Given the lesson 1 test settings are 2 attempts with a pause of 60 minutes
    And a doctor has failed "Тест по уроку 1" twice
    When the doctor starts "Тест по уроку 1" again
    Then the start is refused with "LEARNING_ATTEMPT_UNAVAILABLE" naming when the next attempt opens

  @EARS-20 @learning-doctor-journeys
  Scenario: A doctor who knows the material tests out to a later lesson
    Given a doctor is signed in on the doctor storefront
    And lesson 2 has a test-out test with the threshold 80 %
    When the doctor chooses «Перейти сюда — сдать тест по пропущенному» on lesson 2
    And answers the test-out test with a score of 85 %
    Then lesson 1 is done on the path
    And the step "Разрыв ПКС у бегуньи" is marked «Вы здесь»

  @EARS-20
  Scenario: A failed test-out changes nothing
    Given a doctor is signed in on the doctor storefront
    And lesson 2 has a test-out test with the threshold 80 %
    When the doctor answers the test-out test of lesson 2 with a score of 50 %
    Then lesson 1 is not done on the path
    And the screen says what to do next

  @EARS-9 @EARS-20
  Scenario: «ДПО / аккредитация» offers no test-out unless the course overrides it
    Given the course "ortho-basic" has the preset «ДПО / аккредитация» applied
    When a signed-in doctor opens "/courses/ortho-basic"
    Then no node offers «Перейти сюда — сдать тест по пропущенному»
    When the course overrides "test-out allowed" to yes
    Then lesson 2 offers «Перейти сюда — сдать тест по пропущенному»

  @EARS-21 @learning-doctor-journeys
  Scenario: A doctor repeats a done lesson without losing the completion
    Given a doctor is signed in on the doctor storefront
    And the doctor has done lesson 1
    When the doctor chooses «Повторить» on lesson 1 and fails its test
    Then lesson 1 stays done on the path
    And feature 025 has received one "lesson.completed" fact for lesson 1

  @EARS-22 @EARS-10 @learning-guest-journeys
  Scenario: A guest sees the lesson and the honest registration gate
    Given a visitor who is not signed in
    When the visitor opens the step "Тест Лахмана" of "/courses/ortho-basic"
    Then the lesson description, the list of steps with durations and the teaser are shown
    And the step shows «Чтобы пройти урок, нужна регистрация. Вернём вас сюда.»
    And the step payload read answers 401
    When the visitor registers from the gate
    Then the doctor lands on the step "Тест Лахмана" showing «Смотреть видео»

  @EARS-10
  Scenario: A fact for a locked step is refused and a replay is a duplicate
    Given a doctor is signed in on the doctor storefront
    When the doctor's client reports progress on "Разрыв ПКС у бегуньи"
    Then the report is refused with "LEARNING_STEP_LOCKED" and nothing is stored
    When the doctor's client reports the same progress event on "Тест Лахмана" twice
    Then one fact is stored

  @EARS-16 @EARS-23 @learning-doctor-journeys
  Scenario: A partner's material is labelled and its feedback reaches the staff
    Given lesson 1 has the partner download "Протокол реабилитации" of the published organisation "Партнёр А"
    And a doctor is signed in on the doctor storefront
    When the doctor opens the step "Протокол реабилитации"
    Then the step reads «Партнёрский материал · Партнёр А»
    When the doctor sends feedback "Полезная схема" on the step
    And rates lesson 1 with 4 stars
    Then the lesson composition screen of lesson 1 in the admin lists the feedback "Полезная схема"

  @EARS-16
  Scenario: A microlearning step, a podcast companion and a clinical case count by their own definitions
    Given lesson 1 also has a microlearning step of 5 cards, a podcast companion and a clinical case
    And a doctor is signed in on the doctor storefront
    When the doctor views every card with «Следующая карточка»
    And listens to the podcast to 90 %
    And reaches the end of the clinical case
    Then each of the three steps is done on the path

  @EARS-4 @EARS-28 @learning-admin-journeys
  Scenario: A staff member composes a lesson and cannot publish it incomplete
    Given a staff member who may edit the course is signed in to the admin with a second factor
    When the staff member creates lesson 3 "Тендинопатия ахиллова сухожилия" in "Суставы и хрящ"
    And adds a video step and a download step
    And publishes lesson 3
    Then the publish is refused naming the missing exit test
    When the staff member adds the exit test with two questions and publishes lesson 3
    Then lesson 3 is on the doctor's path of "ortho-basic"

  @EARS-4 @EARS-13
  Scenario: An unpublished lesson leaves the doctor's path and keeps the facts
    Given a doctor has done the video of lesson 2
    When a staff member unpublishes lesson 2
    Then the path of "ortho-basic" shows no lesson 2
    And the doctor's fact for the video of lesson 2 is still stored

  @EARS-5 @EARS-9 @EARS-29 @learning-admin-journeys
  Scenario: A preset applies in one action and a module override wins
    Given a staff member who may edit the draft course "ortho-draft" is signed in to the admin with a second factor
    When the staff member applies «ДПО / аккредитация» to "ortho-draft"
    And overrides the order of its first module to free
    Then the rules of the first module show "order" as «Задано здесь»
    And the rules of the second module show "order" as «Унаследовано от: курс» with the preset «ДПО / аккредитация»
    And the threshold of every lesson shows 80 %

  @EARS-6 @EARS-29
  Scenario: A completion rule outside its scope is refused
    Given a staff member who may edit the draft course "ortho-draft" is signed in to the admin with a second factor
    When the staff member sets a lesson's completion to «N из M» with N greater than its conditions
    Then the rule is refused with a field error and nothing changes

  @EARS-30
  Scenario: Rules of a published course need the learning-rules role
    Given a staff member who may edit the course but has no «Редактор правил обучения» role
    When the staff member changes the threshold of lesson 1 of "ortho-basic"
    Then the change is refused and nothing changes

  @EARS-31 @EARS-24 @EARS-11 @EARS-17 @learning-admin-journeys
  Scenario: A rule change on a live course shows the impact and keeps earned completions
    Given a doctor passed "Тест по уроку 1" with 82 %
    And a staff member with the role «Редактор правил обучения» is signed in to the admin with a second factor
    When the staff member raises the threshold of lesson 1 to 85 %
    Then the change dialog shows 1 doctor whose status would change and «Сохранить заработанные зачёты» chosen
    When the staff member confirms the change
    Then lesson 1 stays done for the doctor
    And the lesson completion line reads «Урок засчитывается, когда пройдены все шаги и тест сдан не ниже 85 %»
    And one change-audit row names the staff member

  @EARS-31 @EARS-24
  Scenario: A rule change that requires completions again tells the doctor why
    Given a doctor passed "Тест по уроку 1" with 82 %
    And a staff member with the role «Редактор правил обучения» is signed in to the admin with a second factor
    When the staff member raises the threshold of lesson 1 to 85 % choosing «Потребовать заново»
    Then lesson 1 is not done for the doctor
    And lesson 1 shows the reason that its test threshold became 85 %
    And the doctor's attempt with 82 % is still stored

  @EARS-12
  Scenario: A module completion reaches 025 once
    Given a doctor has done every lesson of "Суставы и хрящ" and attended its club
    Then feature 025 has received one "module.completed" fact for "Суставы и хрящ" with mode "online"

  @EARS-25 @learning-phone
  Scenario: The path and every step type work on a phone and pass axe
    Given a doctor is signed in on the doctor storefront at a 390 px viewport
    When the doctor opens "/courses/ortho-basic" and each step type
    Then no page scrolls horizontally and every control is keyboard-reachable
    And each page passes the playwright-axe gate

  @EARS-27
  Scenario: The Academy has no course path
    When a visitor opens "/courses/ortho-basic" on the Academy host
    Then the Academy not-found page is shown

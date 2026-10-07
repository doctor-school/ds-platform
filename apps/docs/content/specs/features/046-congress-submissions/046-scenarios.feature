@feature:046 @track:doctor @host:doctor
Feature: 046 — Congress submissions: oral talks, posters and abstracts
  As a registered congress participant, a program committee member, a congress partner and a platform administrator
  I want submissions of three kinds to be prepared, sent, reviewed and read in one platform cabinet and one admin registry
  So that every submission belongs to a registered participant, deadlines and limits are settings, and the author always sees the committee's decision

  Background:
    Given the 2027 congress event starts on 2027-04-23 and has intake settings
    And oral talks are open until 2027-01-15 inclusive, Moscow time
    And posters and abstracts are open until 2027-01-29 inclusive, Moscow time
    And abstracts are limited to 3 per submitting account, oral talks and posters are unlimited, posters have an age limit of 40
    And the first-author counting rule is off

  @EARS-1 @EARS-2 @EARS-3
  Scenario: Platform administrator sets the intake without a release
    Given a platform administrator is signed in to the admin
    And a new event has no intake settings
    When the administrator opens the intake settings of that event
    Then the form is prefilled with abstracts limited to 3, oral talks and posters unlimited, a poster age limit of 40, the first-author rule off and no dates
    When the administrator enters the opening day 2026-11-01 and the last oral day 2027-01-15 and saves
    Then the oral closing instant is stored as 2027-01-16T00:00+03:00
    And the next author request sees oral talks open without a release
    And the change is recorded by the 010 change audit with the administrator as the actor
    And the form has no revision date, because each submission's revision deadline comes from its own revision request
    When the administrator enters a last day before the opening day and saves
    Then the save is refused and nothing changes
    When the administrator enters an opening day for posters without a last day and saves
    Then the save is refused and nothing changes

  @EARS-4 @EARS-15
  Scenario: A guest enters the section from the congress site by an emailed code
    Given a participant registered on the congress site and received the 044 confirmation letter
    Then the letter carries no link, button or URL
    And it tells in text that the cabinet entry is the «Войти в кабинет» button on the congress site, naming "orthobio.ru" as plain text
    When the participant opens "/login?method=code&returnTo=/account/congress" on the doctor storefront origin
    Then the email-code method is shown directly
    When they request a code for their email and enter the six-digit code from the mail
    Then the shell lands on "/account/congress" showing "Мои заявки на Конгресс"

  @EARS-5
  Scenario: An account without a congress registration
    Given a signed-in account with no registration for the congress
    When it opens the section
    Then the section shows only "Сначала зарегистрируйтесь участником Конгресса" with a link to "https://orthobio.ru/registration"
    And an API request creating a submission for that account and event is refused

  @EARS-6 @EARS-7 @EARS-8 @EARS-11
  Scenario: Oral talk draft is prefilled and saved as the author types
    Given a signed-in participant registered for the congress as "Иванова Мария Сергеевна", workplace "ГКБ №1"
    When the participant creates an oral talk
    Then author 1 is prefilled as "Иванова Мария Сергеевна", "ГКБ №1"
    And the form shows "Формат участия — очный"
    When the participant types a title and half of the summary and pauses
    Then the draft is saved without pressing any button and the form shows "Сохранено"
    When the participant reloads the section
    Then the list shows the oral talk with the status "Черновик" and the typed text is still there

  @EARS-9 @EARS-14 @EARS-16
  Scenario: Sending the first oral talk
    Given the participant's oral talk draft is complete
    When the participant sends it
    Then the form asks for the congress submission personal-data consent, linking to the document "Согласие на обработку персональных данных для заявок на Конгресс"
    When the participant accepts it and sends
    Then the submission status becomes "Отправлена" with the send instant
    And one consent record is written under the purpose "congress-submission-personal-data" with the version of that document
    And a receipt letter naming the talk, with no link and naming "orthobio.ru" only as text, is sent after commit and its outcome is recorded on the submission
    When the participant sends a second oral talk
    Then the consent is not asked again

  @EARS-9 @EARS-10
  Scenario: A draft whose kind is closed cannot be sent
    Given the current time is 2027-01-16T00:00+03:00
    And the participant has an oral talk draft
    When the participant opens the draft
    Then the draft shows "Приём устных докладов закрыт 15 января 2027 — отправить заявку нельзя" and no active send action
    And a send request reaching the API is refused with the closed state and changes nothing

  @EARS-10
  Scenario: A kind whose opening date is not announced yet
    Given the poster kind has no opening date
    When the participant creates a poster draft
    Then the draft shows "Дату открытия приёма объявят позже" and no active send action

  @EARS-12 @EARS-13
  Scenario: Take a sent talk back for correction and delete a draft
    Given the participant has a sent oral talk that the committee has not taken into review
    When the participant chooses «Забрать на исправление» before 2027-01-16T00:00+03:00
    Then its status becomes "Черновик" and it no longer appears in the committee registry
    When the participant deletes that draft after confirming
    Then it is gone from the section
    And a request to delete a submission in review is refused
    When the committee takes a sent talk into review while the participant takes it back
    Then the talk stays "На рассмотрении" and the take-back is refused

  @EARS-12 @EARS-17
  Scenario: Withdraw after review started keeps the place in the limit
    Given the participant has an abstract "На рассмотрении" and two abstracts "Отправлена"
    When the participant chooses «Отозвать» on the abstract in review and confirms
    Then its status becomes "Отозвана", it opens read-only with no action, and no letter is sent
    And the committee registry lists it as "Отозвана" with no status control
    And a resend or an autosave of it is refused
    When the participant sends a fourth abstract
    Then the send is refused with "Можно отправить не больше 3 тезисов"
    Given the current time is 2027-01-30T00:00+03:00 and the participant has an oral talk "Отправлена"
    Then the talk offers «Отозвать» and not «Забрать на исправление»
    And an accepted or a rejected submission offers neither

  @EARS-17
  Scenario: Abstract limit counts every sent abstract of the submitting account
    Given the participant has three abstracts in the statuses "Отправлена", "На рассмотрении" and "Отклонена"
    When the participant sends a fourth abstract
    Then the send is refused with "Можно отправить не больше 3 тезисов" and the draft stays a draft
    When the participant takes the "Отправлена" abstract back to a draft while abstract intake is open
    And the participant sends the fourth abstract again
    Then it becomes "Отправлена"

  @EARS-18 @EARS-19 @EARS-20
  Scenario: Poster eligibility by birth date
    Given the participant's account has no birth date
    When the participant starts a poster
    Then a poster draft is created with the title, authors without a presenting mark, goal and content fields, no file field, and the birth-date field
    When the participant sends the draft without a birth date
    Then the birth-date field says "Укажите дату рождения" and the draft stays a draft
    When the participant enters 1987-04-23
    Then the birth date is stored on the account
    And the send is refused with "Постерные доклады принимают от участников младше 40 лет на дату начала Конгресса — 23 апреля 2027. На эту дату вам будет 40 лет."
    And oral talks and abstracts stay available
    When the participant corrects the birth date to 1987-04-24 and sends the poster
    Then it becomes "Отправлена"

  @EARS-21 @EARS-22 @EARS-23
  Scenario: Abstracts with the total counter and the statements
    Given the participant creates abstracts
    Then the form shows the sections "Актуальность", "Цель", "Материалы и методы", "Результаты и обсуждение", "Выводы" as plain-text fields and one total counter
    When the five sections together reach 5001 characters including spaces
    Then the counter is marked and a send is refused naming the 5000-character limit
    When the participant shortens the text to 5000 characters and sends without the statements
    Then the send is refused naming both statements
    When the participant confirms both statements and sends
    Then both statements are stored on the submission with their instant
    And no consent other than the congress submission personal-data consent is asked

  @EARS-24
  Scenario: First-author rule when the organisers turn it on
    Given the first-author counting rule is on
    And three sent abstracts from other submitters name "Петров Иван" as first author
    When the participant sends abstracts whose first author is "Петров Иван"
    Then the send is refused naming the first-author limit

  @EARS-25
  Scenario: Abstracts from an existing talk
    Given the participant has a sent oral talk "Регенеративная терапия коленного сустава"
    When the participant chooses «Подать тезисы по этой работе» on its card
    Then an abstract draft is created with that title and the same authors
    And the abstract card in the admin shows the link to the oral talk

  @EARS-26 @EARS-27 @EARS-31
  Scenario: Committee member works the registry of the bound event only
    Given a principal holding only "congress-program-committee" bound to the 2027 congress
    When the principal signs in to the admin
    Then the navigation shows only "Заявки" for the 2027 congress
    And the registry lists sent submissions of every kind and no draft
    When the principal filters by kind "Тезисы" and status "Отправлена" and sorts by send date
    Then only matching submissions are listed in that order
    And requests for another event, the 044 participant roster or the intake settings are refused

  @EARS-28 @EARS-29
  Scenario: Committee asks for a revision
    Given the current time is 2027-02-16T11:00+03:00, a Tuesday
    And the committee member opens a sent oral talk in the side panel
    Then the card shows the content, the authors, the submitter's email and phone and the status history
    When the member chooses "На доработке" without a comment
    Then the change is refused asking for a comment
    When the member enters "Уточните образовательную цель" and saves
    Then the status becomes "needs_revision" and the change is recorded with the member as the actor
    And the submission's revision deadline is stored as 2027-02-20T00:00+03:00 and the card shows it
    And the author receives a letter carrying "Уточните образовательную цель" and the deadline "до 19 февраля 2027, 23:59 МСК"
    When the member later sets "На рассмотрении" on another submission
    Then no letter is sent

  @EARS-28
  Scenario: A withdrawn committee grant stops the status change
    Given the committee member's grant was withdrawn in the IdP during the session
    When the member saves a status change
    Then the change is refused by live revalidation with the program-committee error and nothing changes

  @EARS-11 @EARS-30 @EARS-34
  Scenario: Author revises and resends before the deadline
    Given the author's oral talk was returned "На доработке" on 2027-02-16 with the comment "Уточните образовательную цель"
    And the current time is 2027-02-17T13:00+03:00
    When the author opens the section
    Then the talk shows the status "На доработке" and the comment "Уточните образовательную цель"
    And the section shows "Исправить и отправить до 19 февраля 2027, 23:59 МСК" and "осталось 2 дня 11 часов"
    When the author edits the goal and sends on 2027-02-18, after the oral intake closed
    Then the status becomes "Отправлена" and a new receipt letter is sent
    And the resend is not counted against the kind's limit a second time

  @EARS-34
  Scenario: The revision term skips the weekend
    Given the committee sets "На доработке" on a poster at 2027-02-19T17:00+03:00, a Friday
    Then the poster's revision deadline is stored as 2027-02-25T00:00+03:00, the end of Wednesday 24 February
    And no intake setting changes that deadline

  @EARS-28 @EARS-30 @EARS-35
  Scenario: An expired revision waits for the committee, and the platform administrator extends another
    Given the author's oral talk is "На доработке" with the revision deadline 2027-02-20T00:00+03:00
    And the current time is 2027-02-20T00:00+03:00
    When the author opens the talk
    Then it is read-only with "Срок доработки истёк 19 февраля, 23:59 МСК (меньше часа назад) — отправить заявку нельзя"
    And an autosave or a send request reaching the API is refused and the status stays "На доработке"
    When a committee member sets "Отклонена" with a comment
    Then the status becomes "rejected" and the author receives the rejection letter
    Given the author's poster is "На доработке" with an expired revision deadline
    When a platform administrator sets «Продлить срок доработки до» 2027-03-03 in its card
    Then the poster's revision deadline is stored as 2027-03-04T00:00+03:00 and the change is recorded with the administrator as the actor
    And the author can edit and send the poster again
    And the same extension from a committee member, or with a day not after the current deadline, is refused

  @EARS-32
  Scenario: Congress partner reads without acting
    Given a principal holding only "congress-partner" bound to the 2027 congress
    When the partner opens a poster in the registry
    Then the card shows the content, the authors and the submitter's contacts
    And the card shows no status control, no committee comment and no age
    And a status-change request from the partner is refused

  @EARS-33
  Scenario: Reminder before the abstract deadline
    Given the participant has two abstract drafts and the current time is 2027-01-27T12:00+03:00
    When the reminder sweep runs twice and on two API instances at once
    Then the participant receives exactly one reminder listing both drafts and the last day 29 January 2027
    When the administrator moves the last abstract day to 2027-01-31 and the sweep runs inside the new 72 hours
    Then the participant receives one new reminder

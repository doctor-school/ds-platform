@feature:048 @track:academy @host:academy
Feature: 048 — Materials feed: own materials, the reading page and the rail on the Academy home
  As a visitor of the Academy and as a platform administrator
  I want the Academy's own news and expert columns written once in the admin and shown in one rail and on their own pages
  So that the home always shows real, current materials and every card leads to a page that exists

  Background:
    Given the published expert "Страхов Михаил Андреевич" is in the experts directory

  @EARS-1 @EARS-2 @EARS-4 @EARS-13 @EARS-14
  Scenario: An administrator writes a news item and it becomes the first card of the rail
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator creates a material of kind «Новость» titled "Открыт набор центров в исследование PRP"
    And writes a body with a level-2 heading, a bulleted list and a bold phrase
    And publishes the material
    Then the material is published
    When a visitor who is not signed in opens the Academy home
    Then the first card of the rail «Новости, блог и видео» reads «Новость», "Открыт набор центров в исследование PRP" and «Академия»

  @EARS-1 @EARS-4 @EARS-13
  Scenario: A column is written on the expert's behalf
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator creates a material of kind «Колонка эксперта» titled "Ортобиология в России: чего не хватает практике"
    And chooses the expert "Страхов Михаил Андреевич"
    And writes a body and publishes the material
    Then the card of "Ортобиология в России: чего не хватает практике" reads «Колонка эксперта» and the expert's name

  @EARS-4
  Scenario: A material without a body cannot be published
    Given a platform administrator is signed in to the admin with a second factor
    And the draft news item "Пустая новость" has a title and an empty body
    When the administrator publishes "Пустая новость"
    Then the publish is refused with a field error on the text
    And "Пустая новость" stays a draft
    And the rail has no card "Пустая новость"

  @EARS-1
  Scenario: A column without an expert is refused
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator saves a material of kind «Колонка эксперта» with no expert chosen
    Then the save is refused with a field error on the expert
    And no material is created

  @EARS-2
  Scenario: A body with a forbidden link is refused
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator saves a body whose link target is "javascript:alert(1)"
    Then the save is refused with a field error on the text
    And the material's body is unchanged

  @EARS-2
  Scenario: Pasted images and tables are stripped by the editor
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator pastes a fragment with a paragraph, an image and a table into the text
    Then the text holds the paragraph
    And the text holds no image and no table

  @EARS-3
  Scenario: The administrator previews an unsaved material
    Given a platform administrator is signed in to the admin with a second factor
    And the administrator has typed a title and a body in a new material without saving
    When the administrator chooses «Предпросмотр»
    Then the material is shown as its reading page with «Предпросмотр — материал не опубликован»
    And no material is saved and the rail is unchanged

  @EARS-5
  Scenario: An edit of a published material shows on the site and keeps its date
    Given the news item "Открыт набор центров в исследование PRP" was first published on 27 October
    And a platform administrator is signed in to the admin with a second factor
    When the administrator changes its title to "Открыт набор центров в исследование эффективности PRP"
    Then its card reads "Открыт набор центров в исследование эффективности PRP" dated «27 октября»
    And its reading page shows the new title

  @EARS-5 @EARS-8
  Scenario: A stale edit is refused
    Given two administrators have the news item "Открыт набор центров в исследование PRP" open
    When the first saves a change and the second then saves another change
    Then the second save is refused as stale with the reload notice
    And the material keeps the first change

  @EARS-6 @EARS-11 @EARS-12
  Scenario: An unpublished material leaves the Academy at once
    Given the news item "Открыт набор центров в исследование PRP" is published
    And a platform administrator is signed in to the admin with a second factor
    When the administrator unpublishes it and confirms
    Then "Открыт набор центров в исследование PRP" is a draft with its text kept
    And the rail has no card "Открыт набор центров в исследование PRP"
    And its reading page address shows the Academy not-found page
    When the administrator publishes it again
    Then its card is back in the rail with its first publication date

  @EARS-7
  Scenario: The administrator finds materials by kind
    Given the published news item "Открыт набор центров в исследование PRP" and the draft column "Ортобиология в России: чего не хватает практике"
    And a platform administrator is signed in to the admin with a second factor
    When the administrator filters «Материалы» by «Колонка эксперта»
    Then the list shows "Ортобиология в России: чего не хватает практике" with the status «Черновик»
    And the list does not show "Открыт набор центров в исследование PRP"

  @EARS-7 @EARS-9 @EARS-11
  Scenario: A column whose expert is no longer published leaves the site
    Given the column "Ортобиология в России: чего не хватает практике" by "Страхов Михаил Андреевич" is published
    When the expert "Страхов Михаил Андреевич" is retired from publication
    Then the rail has no card "Ортобиология в России: чего не хватает практике"
    And its reading page address shows the Academy not-found page
    And the admin list marks it «Не на сайте: эксперт не опубликован»

  @EARS-8
  Scenario: A congress registrar cannot change materials
    Given a congress registrar is signed in to the admin
    Then the registrar's navigation has no «Материалы»
    And every admin material endpoint refuses the registrar

  @EARS-9 @EARS-10 @EARS-14 @EARS-15
  Scenario: A visitor moves the rail and older materials load near its end
    Given 30 published materials exist
    When a visitor on a desktop opens the Academy home
    Then the rail shows the 12 newest cards in two rows with the next column partly visible
    And the button «Назад к более новым материалам» is disabled
    When the visitor presses «Дальше, к более ранним материалам» until the rail nears its end
    Then the next 8 cards load after placeholder cards and «Загружено материалов: 8» is announced
    When the visitor reaches the last card
    Then «Это все материалы.» is announced
    And the button «Дальше, к более ранним материалам» is disabled

  @EARS-14
  Scenario: The keyboard moves the rail one card at a time
    Given 30 published materials exist
    When a visitor focuses the rail on the Academy home and presses ArrowRight
    Then the rail moves by one card
    When the visitor presses End
    Then the rail shows its last loaded cards

  @EARS-14
  Scenario: Nothing in the rail moves by itself
    Given 30 published materials exist
    When a visitor opens the Academy home and waits ten seconds without input
    Then the rail is still at its start

  @EARS-15
  Scenario: A failed next page keeps the loaded cards
    Given 30 published materials exist
    And the second feed page fails once
    When a visitor scrolls the rail to its end
    Then the 12 loaded cards stay and «Повторить» is offered at the end of the rail
    When the visitor chooses «Повторить»
    Then the next 8 cards are shown

  @EARS-16
  Scenario: The empty feed says so honestly
    Given no material is published
    When a visitor opens the Academy home
    Then the feed section shows «Записей пока нет.» and «Здесь появятся новости Академии и публикации из наших соцсетей.»
    And the feed section has no rail and no arrow buttons

  @EARS-16
  Scenario: The feed read fails and retries
    Given 3 published materials exist
    And the first feed page fails once
    When a visitor opens the Academy home
    Then the feed section shows «Не удалось загрузить новости.» with «Повторить»
    And the events block of the home is shown
    When the visitor chooses «Повторить»
    Then the rail shows 3 cards

  @EARS-11 @EARS-12 @EARS-13
  Scenario: A visitor reads a material on its own page
    Given the column "Ортобиология в России: чего не хватает практике" by "Страхов Михаил Андреевич" is published with a body linking to "https://pubmed.ncbi.nlm.nih.gov/"
    When a visitor chooses its card in the rail
    Then the visitor lands on its reading page showing "Ортобиология в России: чего не хватает практике"
    And the page shows «Колонка эксперта», the publication date and the expert's name as plain text
    And the link to "https://pubmed.ncbi.nlm.nih.gov/" targets a new tab with rel "noopener noreferrer"

  @EARS-11 @EARS-12
  Scenario: A draft material has no public page
    Given the draft news item "Черновик новости" with the slug "chernovik-novosti"
    When a visitor opens "/materials/chernovik-novosti" on the Academy
    Then the Academy not-found page is shown

  @EARS-17
  Scenario: The doctor storefront shows nothing of the feed
    Given the news item "Открыт набор центров в исследование PRP" is published with the slug "otkryt-nabor-centrov"
    When a doctor opens "/materials/otkryt-nabor-centrov" on doctor.school
    Then the doctor storefront's not-found page is shown
    And the doctor storefront home has no rail «Новости, блог и видео»

  @EARS-18
  Scenario: The rail, the page and the admin work on a phone
    Given the viewport is 390 px wide
    And 30 published materials exist
    When a visitor opens the Academy home
    Then the rail shows one row with the next card partly visible and no arrow buttons
    When the visitor swipes the rail and opens a card
    Then neither the home nor the reading page scrolls horizontally
    And a platform administrator's material list and material form do not scroll horizontally

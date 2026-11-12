@feature:048 @track:academy @host:academy
Feature: 048 — Materials feed: own materials, the reading page and the rail on the Academy home
  As a visitor of the Academy and as a platform administrator
  I want the Academy's own news and expert columns written once in the admin and shown in one rail and on their own pages
  So that the home always shows real, current materials and every card leads to a page that exists

  Background:
    Given the published expert "Страхов Михаил Андреевич" is in the experts directory

  @EARS-1 @EARS-2 @EARS-4 @EARS-13 @EARS-14 @material-academy-journeys
  Scenario: An administrator writes a news item and it becomes the first card of the rail
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator creates a material of kind «Новость» titled "Открыт набор центров в исследование PRP"
    And writes a body with a level-2 heading, a bulleted list and a bold phrase
    And publishes the material
    Then the material is published
    When a visitor who is not signed in opens the Academy home
    Then the first card of the rail «Новости, блог и видео» reads «Новость», "Открыт набор центров в исследование PRP" and «Академия»

  @EARS-1 @EARS-4 @EARS-13 @material-academy-journeys
  Scenario: A column is written on the expert's behalf
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator creates a material of kind «Колонка эксперта» titled "Ортобиология в России: чего не хватает практике"
    And chooses the expert "Страхов Михаил Андреевич"
    And writes a body and publishes the material
    Then the card of "Ортобиология в России: чего не хватает практике" reads «Колонка эксперта» and «Страхов М. А.»

  @EARS-19 @EARS-9 @EARS-13 @EARS-12 @material-academy-journeys
  Scenario: A material with a partner carries the partner mark
    Given the published organisation "Партнёр А" with its name shown publicly is in the organisation registry
    And a platform administrator is signed in to the admin with a second factor
    When the administrator creates a material of kind «Новость» titled "Совместная программа обучения PRP"
    And chooses the partner "Партнёр А"
    And writes a body and publishes the material
    Then the card of "Совместная программа обучения PRP" reads «Партнёрский материал · Партнёр А»
    And the reading page of "Совместная программа обучения PRP" shows «Партнёрский материал · Партнёр А» under the byline
    When the organisation "Партнёр А" stops showing its name publicly
    Then the card of "Совместная программа обучения PRP" has no partner mark
    And the reading page of "Совместная программа обучения PRP" has no partner mark
    And "Совместная программа обучения PRP" stays in the rail

  @EARS-19 @EARS-13 @EARS-12 @material-academy-journeys
  Scenario: A material without a partner carries no partner mark
    Given the news item "Открыт набор центров в исследование PRP" is published with no partner
    When a visitor opens the Academy home
    Then the card of "Открыт набор центров в исследование PRP" has no partner mark
    And the reading page of "Открыт набор центров в исследование PRP" has no partner mark

  @EARS-4 @material-admin-authoring
  Scenario: A material without a body cannot be published
    Given a platform administrator is signed in to the admin with a second factor
    And the draft news item "Пустая новость" has a title and an empty body
    When the administrator publishes "Пустая новость"
    Then the publish is refused with a field error on the text
    And "Пустая новость" stays a draft
    And the rail has no card "Пустая новость"

  @EARS-1 @material-admin-authoring
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

  @EARS-2 @material-admin-authoring
  Scenario: Pasted images and tables are stripped by the editor
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator pastes a fragment with a paragraph, an image and a table into the text
    Then the text holds the paragraph
    And the text holds no image and no table

  @EARS-3 @material-admin-authoring
  Scenario: The administrator previews an unsaved material
    Given a platform administrator is signed in to the admin with a second factor
    And the administrator has typed a title and a body in a new material without saving
    When the administrator chooses «Предпросмотр»
    Then the material is shown as its reading page with «Предпросмотр — материал не опубликован»
    And no material is saved and the rail is unchanged

  @EARS-5 @material-academy-journeys
  Scenario: An edit of a published material shows on the site and keeps its date
    Given the news item "Открыт набор центров в исследование PRP" was first published on 27 October
    And a platform administrator is signed in to the admin with a second factor
    When the administrator changes its title to "Открыт набор центров в исследование эффективности PRP"
    Then its card reads "Открыт набор центров в исследование эффективности PRP" dated «27 октября»
    And its reading page shows the new title

  @EARS-5 @EARS-9
  Scenario: A published column stays editable while its expert is not published
    Given the column "Ортобиология в России: чего не хватает практике" by "Страхов Михаил Андреевич" is published
    And the expert "Страхов Михаил Андреевич" is unpublished
    And a platform administrator is signed in to the admin with a second factor
    When the administrator changes its title to "Ортобиология в России: что нужно практике"
    Then the edit is saved
    And the rail has no card "Ортобиология в России: что нужно практике"
    When the expert "Страхов Михаил Андреевич" is published again
    Then the card of "Ортобиология в России: что нужно практике" is back in the rail with its first publication date

  @EARS-5 @EARS-8 @material-admin-authoring
  Scenario: A stale edit is refused
    Given two administrators have the news item "Открыт набор центров в исследование PRP" open
    When the first saves a change and the second then saves another change
    Then the second save is refused as stale with the reload notice
    And the material keeps the first change

  @EARS-6 @EARS-11 @EARS-12 @material-academy-journeys
  Scenario: An unpublished material leaves the Academy at once
    Given the news item "Открыт набор центров в исследование PRP" is published
    And a platform administrator is signed in to the admin with a second factor
    When the administrator unpublishes it and confirms
    Then "Открыт набор центров в исследование PRP" is a draft with its text kept
    And the rail has no card "Открыт набор центров в исследование PRP"
    And its reading page address shows the Academy not-found page
    When the administrator publishes it again
    Then its card is back in the rail with its first publication date

  @EARS-7 @material-admin-authoring
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

  @EARS-9 @EARS-10 @EARS-14 @EARS-15 @material-reading-pages
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

  @EARS-14 @material-reading-pages
  Scenario: The keyboard moves the rail one card at a time
    Given 30 published materials exist
    When a visitor focuses the rail on the Academy home and presses ArrowRight
    Then the rail moves by one card
    When the visitor presses End
    Then the rail shows its last loaded cards

  @EARS-14 @material-reading-pages
  Scenario: Nothing in the rail moves by itself
    Given 30 published materials exist
    When a visitor opens the Academy home and waits ten seconds without input
    Then the rail is still at its start

  @EARS-15 @material-reading-pages
  Scenario: A failed next page keeps the loaded cards
    Given 30 published materials exist
    And the second feed page fails once
    When a visitor scrolls the rail to its end
    Then the 12 loaded cards stay and «Повторить» is offered at the end of the rail
    When the visitor chooses «Повторить»
    Then the next 8 cards are shown

  @EARS-16 @material-reading-pages
  Scenario: The first feed page shows placeholders while it loads
    Given 30 published materials exist
    And the first feed page is slow to answer
    When a visitor on a desktop opens the Academy home
    Then the feed section shows 10 placeholder cards
    And both arrow buttons are disabled
    When the first feed page arrives
    Then the rail shows the 12 newest cards
    When a visitor on a phone opens the Academy home while the first feed page loads
    Then the feed section shows 3 placeholder cards

  @EARS-16 @material-reading-pages
  Scenario: The empty feed says so honestly
    Given no material is published
    When a visitor opens the Academy home
    Then the feed section shows «Записей пока нет.» and «Здесь появятся новости Академии и публикации из наших соцсетей.»
    And the feed section has no rail and no arrow buttons

  @EARS-16 @material-reading-pages
  Scenario: The feed read fails and retries
    Given 3 published materials exist
    And the first feed page fails once
    When a visitor opens the Academy home
    Then the feed section shows «Не удалось загрузить новости.» with «Повторить»
    And the events block of the home is shown
    When the visitor chooses «Повторить»
    Then the rail shows 3 cards

  @EARS-11 @EARS-12 @EARS-13 @material-academy-journeys
  Scenario: A visitor reads a material on its own page
    Given the column "Ортобиология в России: чего не хватает практике" by "Страхов Михаил Андреевич" is published with a body linking to "https://pubmed.ncbi.nlm.nih.gov/"
    When a visitor chooses its card in the rail
    Then the visitor lands on its reading page showing "Ортобиология в России: чего не хватает практике"
    And the page shows «Колонка эксперта», the publication date and the expert's name as plain text
    And the link to "https://pubmed.ncbi.nlm.nih.gov/" targets a new tab with rel "noopener noreferrer"

  @EARS-12 @material-reading-pages
  Scenario: A failed material read offers a retry
    Given the news item "Открыт набор центров в исследование PRP" is published with the slug "otkryt-nabor-centrov"
    And the material read fails once
    When a visitor opens "/materials/otkryt-nabor-centrov" on the Academy
    Then the page shows the error state with «Повторить»
    When the visitor chooses «Повторить»
    Then the reading page shows "Открыт набор центров в исследование PRP"

  @EARS-11 @EARS-12 @material-reading-pages
  Scenario: A draft material has no public page
    Given the draft news item "Черновик новости" with the slug "chernovik-novosti"
    When a visitor opens "/materials/chernovik-novosti" on the Academy
    Then the Academy not-found page is shown

  @EARS-17 @material-reading-pages
  Scenario: The doctor storefront shows nothing of the feed
    Given the news item "Открыт набор центров в исследование PRP" is published with the slug "otkryt-nabor-centrov"
    When a doctor opens "/materials/otkryt-nabor-centrov" on doctor.school
    Then the doctor storefront's not-found page is shown
    And the doctor storefront home has no rail «Новости, блог и видео»

  @EARS-18 @material-academy-journeys
  Scenario: The rail, the page and the admin work on a phone
    Given the viewport is 390 px wide
    And 30 published materials exist
    When a visitor opens the Academy home
    Then the rail shows one row with the next card partly visible and no arrow buttons
    When the visitor swipes the rail and opens a card
    Then neither the home nor the reading page scrolls horizontally
    And a platform administrator's material list and material form do not scroll horizontally

  # Slice 2 — Telegram channel connector (EARS-20…EARS-37)

  @EARS-20 @EARS-21 @EARS-31
  Scenario: An administrator adds the Telegram channel to the source list
    Given a platform administrator is signed in to the admin with a second factor
    And the Telegram connector is configured and the bot is a member of the channel "bbmacademy"
    When the administrator adds a source of platform «Telegram» with the address "https://t.me/bbmacademy"
    Then the source list shows «Telegram», "t.me/bbmacademy", «Включён» and the status «Работает»

  @EARS-21
  Scenario: An address that is not a public channel is refused
    Given a platform administrator is signed in to the admin with a second factor
    When the administrator adds a source of platform «Telegram» with the address "https://t.me/+AbCdEfGh123"
    Then the field «Адрес канала» shows «Укажите адрес публичного канала в виде t.me/имя»
    And the source list has no new source

  @EARS-24 @EARS-25 @EARS-26 @EARS-29 @EARS-33 @EARS-34
  Scenario: A new channel post becomes a Telegram card that links to the original
    Given the switched-on Telegram source "t.me/bbmacademy"
    When Telegram delivers with the right secret a photo post 1201 of "bbmacademy" captioned "Сегодня в 19:00 МСК — эфир о показаниях к PRP"
    And a visitor who is not signed in opens the Academy home
    Then the rail has a card reading "Сегодня в 19:00 МСК — эфир о показаниях к PRP", «BBM Academy · Telegram» and «Telegram ↗» with the post's preview
    And that card is a link to "https://t.me/bbmacademy/1201" with a new-tab target and rel "noopener noreferrer"

  @EARS-26 @EARS-34
  Scenario: A video post shows its preview and duration and plays nothing
    Given the switched-on Telegram source "t.me/bbmacademy"
    When Telegram delivers with the right secret a video post 1202 of "bbmacademy" of 72 seconds captioned "PRP при гонартрозе — фрагмент эфира"
    And a visitor opens the Academy home
    Then the card "PRP при гонартрозе — фрагмент эфира" shows a play mark and «1:12»
    And no video plays on the Academy home

  @EARS-27
  Scenario: An album is one card
    Given the switched-on Telegram source "t.me/bbmacademy"
    When Telegram delivers with the right secret three photo parts 1203, 1204 and 1205 of one album of "bbmacademy", the part 1204 captioned "Кадры со съёмок подкаста"
    Then the feed has exactly one card reading "Кадры со съёмок подкаста"
    And that card is a link to "https://t.me/bbmacademy/1203"

  @EARS-24
  Scenario: A webhook call with a wrong secret token is refused
    Given the switched-on Telegram source "t.me/bbmacademy"
    When a request carrying the header X-Telegram-Bot-Api-Secret-Token "wrong" posts a channel post of "bbmacademy" to the Telegram webhook
    Then the webhook answers 401
    And the feed has no new card

  @EARS-25
  Scenario: A post from a channel that is not in the source list is dropped
    Given the switched-on Telegram source "t.me/bbmacademy"
    When Telegram delivers with the right secret a text post 77 of the channel "somebodyelse"
    Then the webhook answers 200
    And the feed has no new card
    And the log records the update as dropped for an unlisted channel without its text

  @EARS-26
  Scenario: A forwarded post and a poll are not cards
    Given the switched-on Telegram source "t.me/bbmacademy"
    When Telegram delivers with the right secret a forwarded post 1206 and a poll 1207 of "bbmacademy"
    Then the feed has no new card

  @EARS-28
  Scenario: An edited post updates its card in place
    Given the switched-on Telegram source "t.me/bbmacademy" has the card of post 1201 dated 12 November
    When Telegram delivers with the right secret an edit of post 1201 captioned "Эфир переносится на 20:00 МСК"
    Then the card of post 1201 reads "Эфир переносится на 20:00 МСК"
    And the card of post 1201 is still dated 12 November and keeps its place in the rail

  @EARS-22 @EARS-25 @EARS-33
  Scenario: A switched-off source leaves the rail and keeps its posts
    Given the Telegram source "t.me/bbmacademy" has the card of post 1201 in the rail
    And a platform administrator is signed in to the admin with a second factor
    When the administrator switches the source "t.me/bbmacademy" off and confirms
    Then the rail on the Academy home has no card of "t.me/bbmacademy"
    And «Публикации» of "t.me/bbmacademy" still lists post 1201 as «Источник выключен»
    When Telegram delivers with the right secret a text post 1210 of "bbmacademy"
    Then the feed has no card of post 1210
    When the administrator switches the source "t.me/bbmacademy" on
    Then the rail again has the card of post 1201 at its own date

  @EARS-32 @EARS-33
  Scenario: An administrator hides one post
    Given the Telegram source "t.me/bbmacademy" has the cards of posts 1201 and 1202 in the rail
    And a platform administrator is signed in to the admin with a second factor
    When the administrator chooses «Скрыть из ленты» on post 1202 in «Публикации» and confirms
    Then the rail on the Academy home has the card of post 1201 and no card of post 1202
    And «Публикации» lists post 1202 as «Скрыт»
    When Telegram delivers with the right secret an edit of post 1202
    Then the rail still has no card of post 1202
    When the administrator chooses «Вернуть в ленту» on post 1202
    Then the rail again has the card of post 1202 at its own date

  @EARS-29
  Scenario: A failed preview download keeps the card without an image
    Given the switched-on Telegram source "t.me/bbmacademy"
    And the Telegram file download fails
    When Telegram delivers with the right secret a photo post 1211 of "bbmacademy" captioned "Новый набор в программу"
    Then the rail has the card "Новый набор в программу" in its no-image layout with the field mark «Telegram»
    And the source "t.me/bbmacademy" keeps the status «Работает»
    When the Telegram file download works again and the preview retry runs
    Then the card "Новый набор в программу" shows the post's preview

  @EARS-30
  Scenario: The one-off import brings in earlier posts and a re-run duplicates nothing
    Given the Telegram source "t.me/bbmacademy" has the card of post 1201 delivered by the webhook
    And a Telegram Desktop JSON export of "bbmacademy" holds the text posts 900, 901 and 1201 and a service message 902
    When the operator runs the history import with that export for "t.me/bbmacademy"
    Then the feed has cards of posts 900 and 901 at their Telegram dates and one card of post 1201
    And the import reports 2 written, 1 skipped as existing and 1 dropped as a service message
    When the operator runs the history import with the same export again
    Then the import reports 0 written
    And the feed has exactly one card each of posts 900, 901 and 1201

  @EARS-30
  Scenario: An export of another channel is refused
    Given the Telegram source "t.me/bbmacademy" bound to its Telegram channel id
    When the operator runs the history import for "t.me/bbmacademy" with an export of another channel
    Then the import exits with an error and writes nothing

  @EARS-31 @EARS-35
  Scenario: An unreachable Telegram marks the source failing and leaves the rail working
    Given the Telegram source "t.me/bbmacademy" has the card of post 1201 in the rail
    And Telegram is unreachable
    When the hourly source check runs
    Then the source list shows "t.me/bbmacademy" with «Ошибка: Telegram недоступен»
    When a visitor opens the Academy home
    Then the rail shows the card of post 1201 and the other cards with no error state

  @EARS-31
  Scenario: A renamed channel shows as failing until its address is edited
    Given the Telegram source "t.me/bbmacademy" bound to its Telegram channel id
    And the channel is renamed to "bbm_academy"
    When the hourly source check runs
    Then the source list shows "t.me/bbmacademy" with «Ошибка: Адрес канала изменился на t.me/bbm_academy»

  @EARS-23
  Scenario: A congress registrar cannot manage sources
    Given a congress registrar is signed in to the admin
    Then the admin navigation has no «Источники»
    And a request to add a feed source is refused

  @EARS-36
  Scenario: No secret or post author is stored or logged
    Given the switched-on Telegram source "t.me/bbmacademy"
    When Telegram delivers with the right secret a text post 1212 of "bbmacademy" signed by its author
    Then no stored row and no log line carries the bot token, the webhook secret, the raw update or the author signature

  @EARS-37
  Scenario: The source pages work on a phone
    Given the viewport is 390 px wide
    And a platform administrator is signed in to the admin with a second factor
    When the administrator opens «Источники» and the «Публикации» of "t.me/bbmacademy"
    Then neither page scrolls horizontally and both pass the accessibility check

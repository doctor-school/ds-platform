# 017 — Doctor storefront shell and the specialty catalog — scenarios
# Tags map every scenario to the flat EARS clauses in 017-requirements-en.md.
# This is a user-facing spec: guest and doctor journeys run through Playwright BDD
# against the real apps/doctor -> NestJS -> Postgres stack. Reference-book and
# targeting assertions that have no visual surface run in Vitest e2e.
# Stage-A picks in force: F-017-1 = variant Б (search-first catalog),
# F-017-2 = the leaderboard as its own home-page section.

Feature: A doctor arrives at their own storefront, picks a specialty, and the site becomes theirs

  Background:
    Given the storefront is apps/doctor serving doctor.school on the shared design system
    And the specialty book is the closed Минздрав list seeded from the nomenclature order in force plus «Другое»
    And adjacency is read from the managed directions-to-specialties link and the direction adjacency relation
    And nothing on the home page requires an account to read
    And no surface states who finances the doctor's learning and none shows a price, cart or subscription
    And the vendored canvas design-source/doctor-home.dc.html is the composition source of truth

  # ------------------------------------------------------------------- shell

  @EARS-1 @happy
  Scenario Outline: The header states sign-in status with exactly one action cluster
    Given a visitor who is <status>
    When they open any storefront route
    Then the header renders the <cluster> cluster
    And the other cluster is absent from the rendered page
    And the header, navigation and footer come from the single storefront shell layout

    Examples:
      | status    | cluster                            |
      | a guest   | «Войти» plus «Регистрация»         |
      | signed in | points plate plus «Личный кабинет» |

  @EARS-1 @failure
  Scenario: A route defining its own header is a defect
    Given the storefront routes of features 017 through 021
    When the rendered header, navigation and footer of each route are compared
    Then every route renders the same shell layout module
    And no route declares a header, navigation or footer of its own

  @EARS-1 @EARS-12 @happy
  Scenario: The footer carries the documents links and the single Academy crossing
    When a visitor opens the storefront home page
    Then the footer shows the «Документы и контакты» links
    And exactly one Academy link exists on the rendered page, in the footer
    And it targets the Academy home page
    And no project card, Academy podcast, partner news block or backstage navigation entry is present

  # -------------------------------------------------------------------- hero

  @EARS-2 @happy
  Scenario: The hero states the offer without stating who pays
    When any visitor opens the storefront home page
    Then the headline, the sub-line about free learning and the evolutionary goal render verbatim
    And no «готовится» marker appears beside the evolutionary goal
    And the four scale counters render from one computed read carrying its computedAt
    And no rouble amount, cart, subscription or payment affordance appears anywhere on the page
    And the page never states who finances the doctor's learning

  @EARS-2 @failure
  Scenario: A counter with no source is omitted rather than shown as zero
    Given one of the four scale counters has no available source
    When any visitor opens the storefront home page
    Then that counter is absent from the rendered statistics row
    And the remaining counters render normally
    And no counter renders as a zero

  # --------------------------------------------------------------- the book

  @EARS-3 @happy
  Scenario: The specialty book is the closed Минздрав list plus «Другое»
    When the public specialty book is read
    Then it returns every seeded book entry plus the «Другое» entry
    And the reported total equals the number of entries returned
    And each entry carries a stable id
    And specialties, directions and schools are three distinct read models

  @EARS-3 @failure
  Scenario: A specialty outside the book is refused
    When a choice is submitted for an identifier that is not a member of the specialty book
    Then the request is refused as a Problem Details document with an exact errorCode
    And no choice is recorded
    And no storefront path is able to write a new entry into the book

  # ----------------------------------------------------------- the catalog

  @EARS-4 @happy
  Scenario: The catalog is the first action, presented as search with the frequent specialties beneath
    Given a visitor with no chosen specialty
    When they open the storefront home page
    Then the catalog renders a labelled search field over the whole list as its hero element
    And the frequent specialties render beneath it
    And a «Показать весь список — N» control, N rendered from the actual book size, reveals the remainder including «Другое»
    And the list is never presented as a bare full-length scroll

  @EARS-4 @EARS-6 @happy
  Scenario: Nothing blocks the page before a choice is made
    Given a visitor with no chosen specialty
    When they open the storefront home page and scroll to the footer
    Then the events block and the leaderboard are both readable
    And no modal gate, interstitial, scroll lock or empty page appears at any point

  @EARS-5 @happy
  Scenario Outline: Typing a fragment narrows the whole book, not the frequent set
    Given a visitor on the open catalog
    When they type "<fragment>" into the search field
    Then the list narrows to entries containing that fragment anywhere in the name
    And the match ignores letter case and the ё/е distinction
    And entries outside the frequent set are reachable this way

    Examples:
      | fragment |
      | орто     |
      | ОРТО     |
      | акушер   |

  @EARS-5 @failure
  Scenario: A query matching nothing keeps the search recoverable
    Given a visitor on the open catalog
    When they type a fragment that matches no entry
    Then the catalog states in plain Russian that nothing was found
    And the typed query remains in the field and editable
    And «Другое» remains reachable

  # -------------------------------------------------------------- the memory

  @EARS-6 @happy
  Scenario Outline: The choice is remembered where the actor lives
    Given a visitor who is <status>
    When they choose a specialty and return to the storefront later
    Then the choice is stored <storage>
    And the home page opens directly in its targeted view with the catalog collapsed

    Examples:
      | status    | storage                   |
      | a guest   | in the anonymous session  |
      | signed in | on the doctor's profile   |

  @EARS-6 @happy
  Scenario: A guest's choice is adopted by a profile that has none
    Given a guest who chose a specialty in their session
    And a new account with no primary specialty on its profile
    When they complete registration and make their first authenticated navigation
    Then the session choice is written to the profile
    And the session value is discarded
    And the doctor is not asked anything about it

  @EARS-6 @failure
  Scenario: An existing profile specialty is never overwritten by a session choice
    Given a doctor whose profile already holds a primary specialty
    And a different specialty chosen in the anonymous session before signing in
    When they sign in and make their first authenticated navigation
    Then the profile value stands unchanged
    And the session value is discarded with no prompt and no merge

  @EARS-7 @happy
  Scenario Outline: The collapsed row names the choice and offers to change it
    Given a visitor whose remembered specialty is <specialty>
    When they open the storefront home page
    Then the catalog is collapsed to a single row naming <specialty>
    And the row offers a «сменить» control and the line about the specialty and adjacent areas
    When they activate «сменить»
    Then the catalog re-opens in its full search-first form

    Examples:
      | specialty                    |
      | Травматология и ортопедия    |
      | Другое                       |

  @EARS-7 @happy
  Scenario: Re-choosing re-targets everything without a save step
    Given a visitor with a remembered specialty and the catalog re-opened
    When they choose a different specialty
    Then every targeted block on the page re-renders for the new specialty
    And the new choice is remembered
    And no separate save action was required

  # ------------------------------------------------------------- targeting

  @EARS-8 @happy
  Scenario: Targeting follows the managed books and labels adjacency honestly
    Given a doctor with a chosen specialty whose directions carry managed adjacency rows
    When a targeted block renders
    Then its content is resolved from the specialty's own directions and the adjacent directions read from the managed relations
    And each item reached only through adjacency is labelled as adjacent
    And no item is presented as the doctor's own specialty unless it is

  @EARS-8 @failure
  Scenario: Adjacency is never inferred from name similarity
    Given two specialties whose names share a long common prefix but carry no managed link
    When a targeted block renders for one of them
    Then no content of the other appears through adjacency
    And every item in the targeting set traces to a managed reference row

  @EARS-8 @happy
  Scenario: «Другое» gets the general selection and is told so
    Given a visitor whose chosen entry is «Другое»
    When the targeted blocks render
    Then they serve the general, non-targeted selections
    And the page states that the selection is general
    And no block renders an empty targeted result

  # ------------------------------------------------------ the other blocks

  @EARS-9 @happy
  Scenario Outline: The events block renders honestly in every data state
    Given the home events read is in state <state>
    When any visitor opens the storefront home page
    Then the events block renders <render>
    And the rest of the page stays usable

    Examples:
      | state    | render                                                          |
      | обычно   | the nearest event cards, the compact month calendar and «Все события» |
      | загрузка | the card skeletons                                              |
      | пусто    | an explicit empty statement pointing at adjacent areas          |
      | ошибка   | an explicit Russian error message with a retry control          |

  @EARS-9 @happy
  Scenario: Retrying a failed events read recovers the block
    Given the events block rendered its error state
    When the visitor activates the retry control and the read succeeds
    Then the block renders the nearest events
    And no page reload was required

  @EARS-9 @happy
  Scenario Outline: The events block is general before a choice and targeted after
    Given a visitor who has <choice>
    When they open the storefront home page
    Then the events block renders its <form> form
    And «Все события» links into the events feed

    Examples:
      | choice                  | form      |
      | not chosen a specialty  | general   |
      | chosen a specialty      | targeted  |

  @EARS-10 @happy
  Scenario: «Что исследовать» is deferred until its content exists, not stubbed
    When any visitor opens the storefront home page
    Then no «Что исследовать» block renders on the page
    And no format card, sample lesson count, duration or step figure from the canvas renders
    And no «Все школы», «Все уроки» or «Все разборы» link renders
    And no empty box, skeleton or «скоро» marker stands in for the block
    And the home page reads as complete without it

  @EARS-11 @happy
  Scenario: The leaderboard is its own section and lists only consenting doctors
    Given doctors both with and without a recorded public-display consent
    When any visitor opens the storefront home page
    Then the leaderboard renders as its own home-page section
    And only doctors with a recorded consent appear in it
    And a note beside the block states that participation is voluntary
    And the «Весь лидерборд →» link is present

  @EARS-11 @failure
  Scenario: A signed-in doctor without consent is told calmly, not shown a fabricated row
    Given a signed-in doctor who has not consented to public display
    When they open the storefront home page
    Then the leaderboard block explains that they have no row because they have not allowed public display
    And it says the setting is changeable in the cabinet
    And no row for them exists in the response body
    And no row is fabricated, inferred or anonymised into existence

  # ------------------------------------------------------- marketing routes

  @EARS-13 @happy
  Scenario: Marketing routes move only after their inventory is confirmed
    Given the enumerated inventory of the public apps/promo routes with their target paths
    And the product owner has confirmed that inventory
    When the routes are served from apps/doctor
    Then every listed route answers from doctor.school under the storefront shell
    And a visitor following an old marketing link stays inside one information architecture with one navigation
    And no listed route responds 404

  @EARS-13 @failure
  Scenario: No route is dropped or invented in the move
    Given the confirmed route inventory
    When the served marketing routes are compared against it
    Then the two sets are identical
    And taking apps/promo out of service was not performed by this work

  # ------------------------------------------------- mobile and accessibility

  @EARS-14 @happy
  Scenario Outline: Every surface works at the mobile breakpoint
    Given the viewport is below the mobile breakpoint
    When a visitor opens the storefront home page
    Then <element> renders in the canvas mobile composition and remains operable

    Examples:
      | element                                     |
      | the header and its action cluster           |
      | the catalog search field and expand control |
      | the collapsed specialty row                 |
      | the events block and its compact calendar   |
      | the leaderboard section                     |

  @EARS-14 @happy
  Scenario: Every storefront surface meets the accessibility bar
    When each 017 route is scanned with playwright-axe at both breakpoints and in both themes
    Then no violation is reported
    And the catalog search field is labelled
    And every catalog entry and the expand control are real labelled interactive elements
    And the leaderboard is readable by a screen reader

  # ------------------------------------------------- admin operator surfaces

  @EARS-16 @happy
  Scenario Outline: Reference-book lists render as records, never as a scrolled table
    Given an operator opens the <section> list in the admin application
    When the viewport is <viewport>
    Then each record renders as <render>
    And no record title or context line is truncated
    And the list is not horizontally scrollable

    Examples:
      | section             | viewport                    | render                |
      | directions          | above the mobile breakpoint | a two-line record row |
      | directions          | below the mobile breakpoint | a record card         |
      | direction adjacency | above the mobile breakpoint | a two-line record row |
      | direction adjacency | below the mobile breakpoint | a record card         |
      | specialty links     | above the mobile breakpoint | a two-line record row |
      | specialty links     | below the mobile breakpoint | a record card         |

  @EARS-16 @happy
  Scenario: A single-action list has no actions column and opens on the row
    Given an operator opens a reference-book list whose records carry exactly one action
    Then the list renders no «Действия» column
    When the operator clicks anywhere in a record row
    Then the record opens
    And the actions column appears only on a list whose records carry two or more actions

  @EARS-16 @happy
  Scenario: The link surface is named after the link
    When an operator opens the admin navigation
    Then the entry for the specialty link surface reads «Связи специальностей»

  @EARS-17 @happy
  Scenario: Filters apply instantly and state what is applied
    Given an operator opens a reference-book list
    When they type into the text search
    Then the list narrows after the debounce with no «Применить» control on any admin surface already rebuilt on the block tier
    And once EARS-20 has converted the last section no «Применить» control exists anywhere in the admin application
    And every active filter renders as a removable chip beside the list
    And a «Сбросить всё» control is offered alongside the chips
    When the operator removes the last chip
    Then the unfiltered list is restored without a page reload

  @EARS-18 @happy
  Scenario: A single-tab record page renders no tab bar
    Given an operator opens a reference-book record with exactly one tab
    Then no tab bar is rendered
    And a record with two or more tabs renders the tab bar

  @EARS-18 @happy
  Scenario: The adjacency kind is a closed explained vocabulary
    Given an operator creates a direction adjacency link
    When they open «Вид связи»
    Then the options are the closed Russian-labelled vocabulary with an explanation line each
    And the stored value is the existing slug for the chosen option
    And a value outside the vocabulary is refused by the API

  @EARS-18 @happy
  Scenario: A record form is one framed panel of ruled sections
    Given an operator opens a reference-book record form
    Then the fields render inside a single framed panel
    And its sections are separated by hairlines
    And each section is led by a statement heading with its explanatory line
    And no section-local form layout is assembled in place of the Field family

  @EARS-18 @happy
  Scenario Outline: Derived and internal fields never reach the operator interface
    Given an operator opens the <surface> of a reference-book record
    Then «Вес» is not rendered
    And the page address is not rendered
    And no note explaining a derived address is rendered in its place

    Examples:
      | surface     |
      | list        |
      | record      |
      | create form |

  @EARS-18 @happy
  Scenario: The page address is derived on create and frozen on first publish
    When an operator creates a reference-book record with a Russian title
    Then its page address is transliterated from that title
    And the address is frozen on first publish
    And the operator is never shown or asked for the address

  @EARS-18 @happy
  Scenario: Status chips stay readable over the row hover state
    When a reference-book list renders a record with a status
    Then the status renders as a chip on the semantic tint tokens
    And no status renders as a bare badge on bg-tint
    And the chip stays readable while the row is hovered

  @EARS-19 @happy
  Scenario: The closed Минздрав book is visible but never editable
    When an operator opens the Минздрав specialty book in the admin application
    Then every seeded entry of the book is listed with the same record patterns
    And no create, edit, delete or import control is present in any state
    And a write request against the book is refused by the API

  @EARS-20 @happy
  Scenario Outline: Every admin section reads as one application
    When an operator opens the <section> section
    Then its list, filters, record surface and status chips are the shared design-system blocks
    And no section-local list, filter bar or status chip is assembled in its place

    Examples:
      | section    |
      | events     |
      | experts    |
      | partners   |
      | projects   |
      | topics     |
      | directions |

  @EARS-20 @happy
  Scenario: An owner-facing stand carries production-representative data
    Given a stand is put in front of the product owner
    When any admin list is opened
    Then its records carry realistic Russian titles
    And their page addresses are the real transliterations of those titles
    And no technical placeholder row is present

  # ------------------------------------------------------------ design gate

  @EARS-15 @process
  Scenario: The storefront design gate runs before implementation and the owner confirms the render
    Given the Stage-A picks variant Б and the leaderboard as a separate section are recorded decisions
    When a canvas-derived storefront surface is built
    Then it is built from the vendored canvas and @ds/design-system primitives with tokens-only styling
    And all four dataState renders with both sign-in states and both choice states are reviewed at both breakpoints and in both themes
    And the canvas composition switcher is not built
    And the product owner confirms the rendered result on the live stand before merge

  @EARS-15 @process
  Scenario: The admin design gate derives from the block tier and the owner confirms the render
    Given the Stage-A picks recorded verbatim on issue 1578 comment 5435209906 are recorded decisions
    When an admin operator surface is built
    Then it is built from the @ds/design-system block tier as the composition source of truth
    And no canvas is used as the source for an operator surface
    And the product owner confirms the rendered operator surfaces on the live branch stand before merge
    And the Stage-B verdict is recorded as a Stage-B: GO entry on the delivering pull request 1575
    And an unanswered Stage-B question blocks the merge

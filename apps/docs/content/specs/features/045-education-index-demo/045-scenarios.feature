@feature:045 @track:academy
Feature: 045 — Education index demo
  As a potential partner and the Academy owner
  I want two temporary public demo pages showing the education index and a partner cabinet
  So that a partner sees the value proposition before features 032 and 035 ship

  Background:
    Given the education-index demo routes are deployed in apps/portal
    And the fixture module carries 12 fictional organisations and the weekly index series

  @EARS-1 @EARS-2 @EARS-3 @EARS-4 @EARS-5 @EARS-11
  Scenario: anonymous visitor sees the public leaderboard
    Given the visitor has no session
    When the visitor opens "/education-index"
    Then the page renders without any login redirect
    And the sticky demo plaque names the leaderboard as demonstration data
    And the leaderboard shows exactly 12 organisations with no podium above the table
    And each row shows its index, rank delta, investment amount and share, doctors, lessons and events

  @EARS-6
  Scenario: Ortella Biotech row is open by default
    Given the visitor opens "/education-index"
    Then the Ortella Biotech row is already expanded
    And two sub-metric bars appear for education-investment share and doctor-attention share

  @EARS-6
  Scenario: any leaderboard row toggles open and closed independently
    Given the visitor is on "/education-index"
    When the visitor clicks a leaderboard row that is closed
    Then that row expands to reveal its two sub-metric bars, and every other row's open/closed state is unchanged
    When the visitor clicks that same row again
    Then that row collapses, and every other row's open/closed state is unchanged

  @EARS-7
  Scenario: index dynamics start at the launch date
    Given the visitor is on "/education-index"
    Then the dynamics chart shows 4 weekly bars for the top-3 organisations starting at week 1
    And no value renders before the index launch date

  @EARS-1 @EARS-8 @EARS-9 @EARS-10 @EARS-11
  Scenario: anonymous visitor sees the partner cabinet
    Given the visitor has no session
    When the visitor opens "/education-index/partner-demo"
    Then the page renders without any login redirect
    And the sticky demo plaque names the cabinet as demonstration data
    And the 4 KPI tiles render
    And the audience table shows exactly 5 rows with the caption "5 of 1240 shown"
    And the "show more" and "export for reporting" controls are disabled

  @EARS-12
  Scenario Outline: theme and viewport render correctly
    When the visitor opens "/education-index" and "/education-index/partner-demo" with theme "<theme>" and viewport "<viewport>"
    Then both pages render with no unstyled or missing token

    Examples:
      | theme | viewport |
      | dark  | 1440     |
      | light | 390      |

  @EARS-13
  Scenario: no forbidden compliance word appears
    When the visitor opens "/education-index" and "/education-index/partner-demo"
    Then the response contains none of "пациент, спасённая жизнь, помощь родственникам, связь с продажами, торговое название препарата, спонсор, рекламодатель, вкладчик, майнинг"

  @EARS-13
  Scenario: pages are not indexable
    When the visitor requests either route
    Then the response carries a noindex robots directive

  @EARS-14
  Scenario: routes are removed once 032 and 035 ship
    Given the release that ships features 032 and 035 has landed
    Then no route under "/education-index" exists in apps/portal
    And the fixture module is deleted

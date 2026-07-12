# 008 — Portal shell & discovery front-door scenarios
# Gherkin for the persistent app-shell header + the public discovery front-door at /.
# Happy path (doctor login -> / -> nav -> profile) + branches (guest sees «Войти» and
# the same /; «Школы» inert; mobile ≡ nav collapse).
# Translated to Playwright via playwright-bdd — this is a user-facing spec, so an
# end-to-end browser run is a REQUIRED deliverable owned in this feature's WBS
# (see 008-requirements-en.md → Verification, the `all` row: apps/portal/e2e/shell/journey.spec.ts),
# NOT a bare footnote (F-22). Tags map scenarios to EARS handlers in 008-requirements-en.md.

Feature: Persistent portal app-shell header and public discovery front-door

  Background:
    Given the portal serves the app-shell header on every route from its configured origin
    And the header is built from the vendored «Doctor.School визуальный язык» canvas via @ds/design-system
    And the feature-004 discovery listing surface is available at /
    And the feature-005 «Мои события» surface is available at /account/events
    And the feature-009 profile surface is available at /account

  @EARS-1 @EARS-2 @EARS-6 @EARS-7 @happy
  Scenario: A doctor logs in, lands on the discovery front-door, and navigates the shell
    Given a registered doctor who is not yet signed in
    When the doctor completes login via the feature-003 auth flow
    Then the doctor lands on "/" showing the discovery listing of upcoming broadcasts
    And the persistent header shows the logo, the top-nav [Эфиры · Школы · Мои события], a theme toggle, and an avatar icon with the doctor's initials
    When the doctor activates «Мои события» in the top-nav
    Then the portal navigates to "/account/events"
    When the doctor activates the avatar icon
    Then the portal navigates to the profile "/account"

  @EARS-4 @EARS-8 @happy
  Scenario: A guest sees «Войти» and the same public discovery front-door
    Given a visitor with no authenticated session
    When the visitor opens "/"
    Then "/" shows the same discovery listing of upcoming broadcasts a doctor sees
    And the header shows a «Войти» button instead of an avatar icon
    And the header shows no avatar and no «Выйти»
    When the visitor activates «Войти»
    Then the portal navigates to the login surface

  @EARS-8 @happy
  Scenario: The discovery front-door does not branch on auth state
    Given the feature-004 listing renders a set of upcoming broadcasts
    When a guest opens "/" and then the same doctor opens "/"
    Then both are shown the identical discovery listing content
    And the only difference between the two renders is the header's account affordance (avatar icon vs «Войти»)

  @EARS-5 @happy
  Scenario: The account affordance is an icon, not a dropdown, and carries no sign-out
    Given a signed-in doctor on any portal page
    When the doctor inspects the header account affordance
    Then it is an avatar icon showing the doctor's initials
    And it is not a dropdown menu
    And no «Выйти» action appears anywhere in the header

  @EARS-9 @happy
  Scenario: The «Каркас приложения» scaffold is retired
    Given the portal previously served a «Каркас приложения» placeholder card at "/"
    When any user opens "/"
    Then the discovery listing is served
    And the «Каркас приложения» placeholder card is not reachable anywhere in the portal

  @EARS-3 @happy
  Scenario: The theme toggle switches and persists the preference
    Given a user on any portal page in the light theme
    When the user activates the theme toggle
    Then the portal switches to the dark theme
    And the preference is persisted in localStorage under "ds-theme"
    And the preference survives a page reload and navigation

  @EARS-10 @branch
  Scenario: «Школы» is a designed but inert nav target
    Given the header top-nav includes a «Школы» item per the canvas
    When a user activates «Школы»
    Then the portal does not navigate away
    And no error is shown
    And «Школы» is presented as not-yet-available, never as a dead link to a broken route

  @EARS-11 @EARS-2 @EARS-10 @branch
  Scenario: On mobile the nav collapses into a ≡ dropdown
    Given a user on a viewport at or below the mobile breakpoint (≤900px)
    When the user opens the header navigation
    Then the top-nav is collapsed into a ≡ dropdown
    And the dropdown carries the same items [Эфиры · Школы · Мои события]
    And selecting «Мои события» navigates to "/account/events"
    And selecting «Школы» stays inert

  @EARS-12 @stage-b
  Scenario: The rendered shell matches the vendored canvas across breakpoints and themes
    Given the persistent header and "/" are built from the vendored canvas via @ds/design-system tokens
    When the product owner reviews the running stand at Stage-B
    Then the rendered result matches the canvas element-by-element at both breakpoints and in both themes
    And no arbitrary Tailwind values are used (tokens only)

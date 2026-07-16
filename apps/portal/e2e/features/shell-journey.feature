# 008 — the portal SHELL journey on the live portal, translated from
# 008-scenarios.feature to the browser surface via playwright-bdd (the requirements
# Verification `all` row: apps/portal/e2e/shell/journey.spec.ts is indicative — the
# REAL mechanism is the `bdd` project, exactly as the 005 registration journey has
# no hand-written journey.spec.ts). The per-EARS guarantees are pinned by the
# e2e/shell/*.spec.ts route pins; HERE we drive the connected arc a person walks:
# a doctor logs in → lands on the discovery front-door `/` → uses the shell nav
# (→ /account/events) and the avatar icon (→ /account); a guest sees «Войти» and
# the SAME `/`; and on a mobile viewport the nav collapses into a ≡ dropdown.
#
# The @stage-b canvas render-parity scenario (008-scenarios.feature EARS-12) is the
# owner's manual Stage-B gate, not an automated step, so it is intentionally not
# translated here. Step titles are DISTINCT from the 004/005/006 journeys
# (playwright-bdd merges every step file into one registry — a duplicate title is an
# ambiguous-step error); the shared Background step is reused, not redefined.

Feature: 008 Portal shell journey — login lands on the discovery front-door, shell nav, guest «Войти», mobile collapse

  Background:
    Given the live dev stand is available

  @EARS-1 @EARS-2 @EARS-6 @EARS-7 @happy
  Scenario: A doctor logs in, lands on the discovery front-door, and navigates the shell
    Given a registered doctor who is not yet signed in
    When the doctor completes login via the feature-003 auth flow
    Then the doctor lands on the discovery front-door at "/"
    And the persistent header shows the logo, the top-nav, a theme toggle, and the doctor's avatar icon
    When the doctor activates «Мои события» in the header nav
    Then the shell navigates to "/account/events"
    When the doctor activates the header avatar icon
    Then the shell navigates to the profile "/account"

  @EARS-4 @EARS-8 @happy
  Scenario: A guest sees «Войти» and the same public discovery front-door
    Given a visitor with no authenticated session
    When the visitor opens the discovery front-door
    Then the discovery listing of upcoming broadcasts is shown
    And the header shows a «Войти» button and no avatar and no «Выйти»
    When the visitor activates «Войти»
    Then the shell navigates to the login surface

  @EARS-11 @EARS-2 @branch
  Scenario: On a mobile viewport the nav collapses into a ≡ dropdown
    Given a doctor on the discovery front-door at a mobile viewport
    When the doctor opens the header ≡ navigation
    Then the ≡ dropdown carries the items [Эфиры · Мои события]
    And selecting «Мои события» in the ≡ dropdown navigates to "/account/events"

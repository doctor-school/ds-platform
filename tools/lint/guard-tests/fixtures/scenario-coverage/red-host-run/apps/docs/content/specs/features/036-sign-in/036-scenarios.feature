# 036 — sign-in-host scenarios with no run class (fixture).
@host:academy
Feature: 036 Sign-in doors

  @EARS-1 @happy @door:login @host:login
  Scenario: A bound door scenario names no run
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

  # stage only — the double has no mail (a comment is no run class)
  @EARS-2 @happy @door:register @host:login @stage-only:login(slow)
  Scenario: A stage-only class outside the fixed list
    Given a guest on the Academy
    When the guest registers
    Then a code is sent

  @EARS-3 @happy @door:login @host:login @stage-only:login
  Scenario: A stage-only tag with no reason class
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

  @EARS-3 @happy @door:login @host:login @pr-ci:login @stage-only:login(mail)
  Scenario: Both run classes on one scenario
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

  @EARS-3 @happy @door:login @quarantine:login(#9003) @pr-ci:login
  Scenario: A run class on a scenario not bound to the sign-in host
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

  @EARS-3 @happy @door:login @host:login
  Scenario Outline: An outline whose second Examples block names no run
    Given a guest on the <surface> form
    Then the guest is signed in

    @pr-ci:login
    Examples:
      | surface |
      | login   |

    Examples:
      | surface  |
      | register |

  @EARS-3 @happy @door:login @host:login @pr-ci:login
  Scenario Outline: An outline run on PR-CI whose Examples block is also stage-only
    Given a guest on the <surface> form
    Then the guest is signed in

    @stage-only:login(mail)
    Examples:
      | surface |
      | login   |

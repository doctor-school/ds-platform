# 036 — door scenarios that are NOT bound to the sign-in host (fixture).
@host:academy
Feature: 036 Sign-in doors

  @EARS-1 @happy @door:login
  Scenario: A guest signs in through the sign-in host
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

  # Retained Academy baseline projection (#9010), not shared-sign-in-host acceptance.
  @EARS-2 @happy @door:register @host:academy
  Scenario: A guest registers
    Given a guest on the Academy
    When the guest registers
    Then a code is sent

  @EARS-3 @happy @door:lgoin @host:login
  Scenario: A guest confirms the code
    Given a registered guest
    When the guest enters the code
    Then the guest is signed in

  @EARS-3 @happy @door:login @host:login @quarantine:login(#9003)
  Scenario: A guest signs in twice
    Given a registered guest
    When the guest signs in again
    Then the guest is signed in

  @EARS-3 @happy @door:register @quarantine:login
  Scenario: A guest registers twice
    Given a registered guest
    When the guest registers again
    Then a code is sent

  @EARS-1 @happy @door:login @host:login @default-auth-limits
  Scenario: A guest signs in under the default auth limits
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

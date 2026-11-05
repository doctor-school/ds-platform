# 036 — door scenarios bound to the sign-in host (fixture).
@host:academy
Feature: 036 Sign-in doors

  @EARS-1 @happy @door:login @host:login
  Scenario: A guest signs in through the sign-in host
    Given a guest on the Academy
    When the guest signs in
    Then the guest is signed in

  # No steps yet: excluded from the sign-in-host binding only, tracked by #9003.
  @EARS-2 @happy @door:register @quarantine:login(#9003)
  Scenario: A guest registers
    Given a guest on the Academy
    When the guest registers
    Then a code is sent

  # verify is not mounted on the sign-in host yet (the registry says wave 9),
  # and `reset` is mounted only in a DIFFERENT registry section, which is not read.
  @EARS-3 @happy @door:verify
  Scenario: A guest confirms the code
    Given a registered guest
    When the guest enters the code
    Then the guest is signed in

  @EARS-3 @happy @door:reset
  Scenario: A guest resets the password
    Given a registered guest
    When the guest resets the password
    Then the guest is signed in

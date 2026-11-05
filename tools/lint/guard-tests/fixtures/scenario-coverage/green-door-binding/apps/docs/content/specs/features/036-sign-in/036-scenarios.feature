# 036 — door scenarios bound to the sign-in host (fixture).
@host:academy
Feature: 036 Sign-in doors

  @EARS-1 @happy @door:login @host:login @pr-ci:login
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

  # The double serves no mail: this binding runs in the stage suite only.
  @EARS-1 @happy @door:login @host:login @stage-only:login(mail)
  Scenario: A guest signs in by the mailed code
    Given a guest on the Academy
    When the guest signs in by the mailed code
    Then the guest is signed in

  # One outline, two runs: its door-only rows run on the PR-CI tier, the row
  # that submits through the captcha runs in the stage suite only. Gherkin
  # tags each Examples block, so the run class is read per block.
  @EARS-2 @happy @door:register @host:login
  Scenario Outline: A guest reveals the password on a door
    Given a guest on the <surface> form
    When the guest reveals the password
    Then the password is plain

    @pr-ci:login
    Examples:
      | surface      |
      | registration |

    @stage-only:login(captcha)
    Examples:
      | surface        |
      | reset-complete |

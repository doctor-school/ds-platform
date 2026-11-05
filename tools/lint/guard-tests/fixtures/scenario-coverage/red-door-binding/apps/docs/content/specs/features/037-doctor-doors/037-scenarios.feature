# 037 — a sign-in-host binding in a doctor-only feature (fixture).
@host:doctor
Feature: 037 Doctor doors

  @happy @door:login @host:login
  Scenario: A doctor signs in through the sign-in host
    Given a guest on the doctor storefront
    When the guest signs in
    Then the guest is signed in

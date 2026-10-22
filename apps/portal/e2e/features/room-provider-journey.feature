# 006 — the room player's provider-enum variants, split out of room-journey.feature
# (#3229) because they need the provider-variant rooms `seed-006-room-youtube` /
# `-rutube` / `-unavailable` (env `E2E_ROOM_SLUG_YOUTUBE` / `_RUTUBE` /
# `_UNAVAILABLE`). The golden dataset a stage slot is cloned from seeds rutube
# streams only, so a slot run keeps this file out with a declared reason
# (`tools/staging/live-tiers.mjs` `slotReason`); the local dev stand seeds all
# three. Steps, self-provisioning and the timezone setup: room-journey.feature.

Feature: 006 Webinar room journey — the room player is instantiated from the provider enum

  Background:
    Given the live dev stand is available

  # --- The player is instantiated from the explicit provider enum (US-1) — EARS-2 ---

  @EARS-2 @failure
  Scenario Outline: The room player is instantiated from the explicit provider enum, not by URL-sniffing
    Given a registered doctor on the "<provider>"-provider live room
    When the doctor enters that provider room
    Then the "<provider>" embed frame is rendered from the enum value, not the other provider

    Examples:
      | provider |
      | youtube  |
      | rutube   |

  @EARS-2 @edge
  Scenario: An unconfigured provider yields the truthful stream-unavailable state, no guessed embed
    Given a registered doctor on the stream-unconfigured live room
    When the doctor enters that unconfigured room
    Then the room shows the truthful stream-unavailable state and renders no embed frame

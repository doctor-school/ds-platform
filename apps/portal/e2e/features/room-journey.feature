# 006 — the webinar-room JOURNEY on the live portal, translated from
# 006-scenarios.feature to the browser surface via playwright-bdd. The api-level
# guarantees (the server-authoritative gate EARS-1, the subscribe-only chat token +
# publish gate EARS-3/EARS-8, the durable presence rows + concurrent-tab
# minute-coalescing EARS-5, the late-beat/late-post refusal EARS-7, the no-public-
# presence invariant EARS-8) are asserted in the apps/api Vitest e2e; HERE we drive
# exactly what a doctor sees and does in the running portal on the live dev stand —
# the required user-facing deliverable (requirements Verification, the `all` row):
# admission → player-from-the-enum → real-time chat → visibility-gated heartbeat →
# denied-access routing → room-close degradation → the browser-observable authz +
# frame-only + МСК-no-drift cross-cuts. The whole run rides a deliberately non-Moscow
# browser timezone (playwright.config `bdd` project, America/New_York) + ru-RU
# locale, so the МСК labels prove no viewer-local drift globally (EARS-10), not just
# in one tagged step.
#
# Self-provisioning: there is NO seeded roster — every scenario builds its roster
# LIVE, minting its doctor through the REAL 003 register→verify(Mailpit-OTP)→
# auto-login flow (support/doctor-session), then completing the REAL 005 registration
# by carrying a `returnTo` to the event page. So the suite runs on `LIVE_STAND` + the
# seeded stream config alone (no operator-seeded credentials). Seeded fixture rooms
# (006↔007 fixture seam): `seed-005-live` (rutube, the happy/chat/heartbeat room),
# `seed-006-room-youtube` / `-rutube` / `-unavailable` (the provider-enum variants),
# `seed-005-upcoming` (the not-live branch), `seed-005-ended` (the closed room). Every
# slug is env-overridable; the whole feature `test.skip`s (its Background gate no-ops)
# when the dev-stand env is absent, so a stray CI invocation is inert. The live run +
# both-breakpoints × both-themes canvas fidelity (EARS-11) is the Stage-B verification
# deliverable, owned separately — this feature is the runnable arc, authored code-only.

Feature: 006 Webinar room journey — a registered doctor watches live, chats in real time, and is silently counted present

  Background:
    Given the live dev stand is available

  # --- Room admission & composition (US-1, US-5) — EARS-1/EARS-2/EARS-9/EARS-10 ---

  @EARS-1 @EARS-2 @EARS-9 @EARS-10 @happy
  Scenario: A registered doctor enters the live room and sees the player and chat
    Given a registered doctor on the live event
    When the doctor enters the live room
    Then the room renders the embed player and the live chat composition
    And the live-room player is a configured provider frame only, never a re-hosted surface
    And the event page the room admits through labels every absolute time in МСК with no viewer-local drift

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

  # --- Live chat fan-out over Centrifugo (US-2) — EARS-3 ---

  @EARS-3 @happy
  Scenario: A posted chat message fans out to the other doctor in real time without a reload
    Given two registered doctors in the same live room
    When one doctor posts a chat message
    Then the other doctor sees the message appear in real time without reloading the page

  # --- Visibility-gated heartbeat presence capture (US-3) — EARS-4 ---

  @EARS-4 @happy
  Scenario: The room fires an authenticated heartbeat every N seconds with no doctor action
    Given a registered doctor watching in the live room with the tab visible
    When the doctor stays in the room across several cadence intervals
    Then the client posts more than one authenticated heartbeat, driven only by the timer

  @EARS-4 @edge
  Scenario: A backgrounded tab pauses the heartbeat and resumes when visible again
    Given a registered doctor posting heartbeats in the live room
    When the room tab is backgrounded so document.hidden becomes true
    Then the client stops posting heartbeats while the tab is hidden
    When the room tab becomes visible again
    Then the client resumes posting authenticated heartbeats

  # --- Denied-access routing, never a soft wall (US-1, US-5) — EARS-6 ---

  @EARS-6 @failure
  Scenario Outline: An unadmissible caller is routed truthfully, never shown a soft wall over the player
    Given a caller who is "<condition>" for the live room
    When the caller reaches the room
    Then the caller is routed to "<destination>" and no room composition is rendered

    Examples:
      | condition                      | destination                      |
      | unauthenticated                | the 003 auth flow                |
      | authenticated but unregistered | the 005 register front door      |
      | on an event that is not live   | the truthful 004 lifecycle state |

  # --- Room close stops capture (US-3, US-4) — EARS-7 ---

  @EARS-7 @happy
  Scenario: A room that has left live degrades to the truthful ended state, no watchable room
    Given a registered doctor reaching the room of an event that has left live
    Then the room degrades to the truthful ended state with no room composition

  # --- Cross-cutting authz — the room reads/commands require a session (US-5) — EARS-8 ---

  @EARS-8 @failure
  Scenario: The room config, chat, and heartbeat endpoints refuse an unauthenticated caller
    Given a guest with no session targeting the live room
    Then the RoomConfig read is refused without a session
    And the chat post is refused without a session
    And the heartbeat post is refused without a session

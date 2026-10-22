# 006 — the visibility-gated heartbeat cadence, split out of room-journey.feature
# (#3229) because it needs an api booted with a SHORT cadence
# (`ROOM_HEARTBEAT_INTERVAL_SECONDS`, mirrored as `E2E_ROOM_HEARTBEAT_SECONDS`) to
# observe several beats inside a test window. A stage slot runs the production
# cadence (60 s), so a slot run keeps this file out with a declared reason
# (`tools/staging/live-tiers.mjs` `slotReason`). Steps, self-provisioning and the
# timezone setup: room-journey.feature.

Feature: 006 Webinar room journey — the doctor is silently counted present on the heartbeat cadence

  Background:
    Given the live dev stand is available

  # --- Visibility-gated heartbeat presence capture (US-3) — EARS-4 ---

  @EARS-4 @happy
  Scenario: The room fires an immediate authenticated heartbeat, then every N seconds with no doctor action
    Given a registered doctor watching in the live room with the tab visible
    When the doctor stays in the room across several cadence intervals
    Then the client posts an entry heartbeat and more timer-driven authenticated heartbeats

  @EARS-4 @edge
  Scenario: A backgrounded tab pauses the heartbeat and resumes when visible again
    Given a registered doctor posting heartbeats in the live room
    When the room tab is backgrounded so document.hidden becomes true
    Then the client stops posting heartbeats while the tab is hidden
    When the room tab becomes visible again
    Then the client posts an immediate authenticated heartbeat before resuming the N-second grid

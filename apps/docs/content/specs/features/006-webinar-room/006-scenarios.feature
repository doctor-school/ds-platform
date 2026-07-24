# 006 — Webinar room scenarios
# Gherkin for the room vertical of the Webinars epic wave 1 (server-side-gated room = embed
# player from an explicit provider enum + live chat over Centrifugo + server-authoritative
# heartbeat presence capture + the room-header theme toggle and JIT display-name avatar).
# Happy paths + failure branches. Translated to Playwright via
# playwright-bdd — this is a user-facing spec, so the browser run is a required deliverable
# (owned + tracked by the 006 portal-integration + E2E child Issue, open-ears-issues step 3a),
# not a bare footnote.
# Tags map scenarios to EARS handlers in 006-requirements-en.md; each EARS realizes a US-N in 006-product.md.

Feature: Webinar room — a registered doctor watches live, chats in real time, and is silently counted present

  Background:
    Given the portal serves the webinar surfaces on its configured origin
    And the auth foundation (feature 003) is available for login and signup
    And the event page and join path (feature 004) are available
    And the registration record and EventRoster (feature 005) are available
    And the event read model is seeded with events in each lifecycle state, with stream config
    And Centrifugo is available for the room chat channel
    And the heartbeat cadence N is a server-side config defaulting to 60 seconds
    And all absolute times are presented in Europe/Moscow labeled МСК

  # --- Room admission & composition (US-1, US-5) ---

  @EARS-1 @EARS-2 @happy
  Scenario: A registered doctor enters a live room and sees the player and chat
    Given a registered doctor on a live event
    When the doctor enters the room
    Then the server issues a RoomAccess grant
    And the room renders the embed player and the live chat to the canvas composition
    And the player is instantiated from the event stream config provider enum, not by URL-sniffing

  @EARS-2 @failure
  Scenario Outline: The player is instantiated from the explicit provider enum
    Given a live event whose stream config provider is "<provider>"
    When a gated doctor opens the room
    Then the embed player for "<provider>" is instantiated from the enum value
    And the provider is never inferred from the stream URL string

    Examples:
      | provider |
      | rutube   |
      | youtube  |
      | vk       |
      | cdnvideo |

  @EARS-2 @edge
  Scenario: An unknown or absent provider yields a truthful stream-unavailable state
    Given a live event whose stream config provider is unknown or absent
    When a gated doctor opens the room
    Then the room shows a truthful "stream unavailable" state
    And no guessed embed is rendered

  # --- In-room player failure states: watchdog + truthful status + in-room retry (US-1) ---

  @EARS-18 @failure
  Scenario: A confirmed failure covers the frame with a truthful status, not a black frame
    Given a gated doctor in a live room on a "youtube" stream whose player handshake was established
    When the stream then stalls with no playing signal within the watchdog threshold
    Then the player region shows a covering, truthful "stream not loading" status overlay
    And the doctor never faces a silent black frame

  @EARS-18 @failure
  Scenario Outline: A YouTube error is a confirmed failure that distinguishes embedding-disabled from unavailable
    Given a gated doctor in a live room on a "youtube" stream
    When the player reports error code "<code>"
    Then the covering status overlay shows "<status>"

    Examples:
      | code    | status                                       |
      | 101     | embedding disabled by the broadcaster        |
      | 150     | embedding disabled by the broadcaster        |
      | 100     | the video is unavailable                     |

  @EARS-18 @edge
  Scenario Outline: An unobservable stall shows a non-covering advisory banner, not a covering wall
    Given a gated doctor in a live room on a "<provider>" stream that never emits a playing signal
    When no playing signal is observed within the watchdog threshold
    Then the player region shows a NON-covering advisory banner beside the still-visible embed
    And the room does not auto-retry or re-create the embed
    And the room offers a manual «Перезапустить плеер» affordance

    Examples:
      | provider |
      | vk       |
      | cdnvideo |

  @EARS-18 @edge
  Scenario: A YouTube embed whose handshake never arrives is treated as suspected, not a false confirmed failure
    Given a gated doctor in a live room on a "youtube" stream whose player API never handshakes
    When no playing signal is observed within the watchdog threshold
    Then the player region shows a NON-covering advisory banner beside the still-visible embed
    And the room does not auto-retry or re-create the embed

  @EARS-18 @happy
  Scenario: On a confirmed failure the room retries in-room and offers a restart, never a page reload or off-platform link
    Given a gated doctor in a live room whose embed reached a confirmed failure state
    When the room reaches the confirmed failure state
    Then the room auto-retries the embed a bounded number of times
    And if it still fails the room offers a «Перезапустить плеер» affordance
    And activating it re-creates the embed without reloading the whole page
    And the room never offers a link to watch off the platform

  @EARS-18 @happy
  Scenario: Recovery clears the truthful status
    Given a gated doctor in a live room showing the "stream not loading" status
    When a playing signal is observed after the failure state
    Then the status (covering overlay or advisory banner) clears
    And the playing stream is presented

  @EARS-18 @EARS-4 @happy
  Scenario: A player failure does not interrupt presence capture
    Given a gated doctor in a live room posting heartbeats with the tab visible
    When the embed enters and stays in the failure state
    Then the heartbeat loop keeps posting every N seconds
    And the doctor remains counted present in the room

  # --- Live chat (US-2) ---

  @EARS-3 @happy
  Scenario: A posted chat message reaches other participants in real time
    Given two registered doctors in the same live room
    When one doctor posts a chat message
    Then the message fans out to the other doctor in real time
    And the other doctor sees it without reloading the page

  @EARS-3 @EARS-8 @failure
  Scenario: A client cannot publish to the room channel without the gated command
    Given a client holding only a subscribe-scoped chat token
    When the client attempts to publish directly to the room channel
    Then the direct publish is rejected
    And a message is posted only through the server-gated command

  # --- Heartbeat presence capture (US-3) ---

  @EARS-4 @happy
  Scenario: Presence is captured by a visibility-gated heartbeat every N seconds
    Given a registered doctor watching in a live room with the room tab visible and active
    When the doctor stays in the room
    Then the client posts an authenticated heartbeat every N seconds
    And each accepted beat appends one durable row (doctor, event, instant) to the presence table
    And the doctor never clicks anything to prove presence

  @EARS-4 @edge
  Scenario: A backgrounded tab pauses the heartbeat and resumes when visible again
    Given a registered doctor in a live room posting heartbeats
    When the room tab is backgrounded so document.hidden becomes true
    Then the client stops posting heartbeats
    And the backgrounded tab's minutes do not count toward the sponsor report
    When the room tab becomes visible again
    Then the client resumes posting an authenticated heartbeat every N seconds

  # --- Presence-minute derivation (US-3, US-4) ---

  @EARS-5 @happy
  Scenario: Concurrent tabs do not inflate a doctor's presence minutes
    Given a doctor with two tabs open in the same live room
    When both tabs post heartbeats over the same minute
    Then the doctor's presence minutes count that minute only once
    And the parallel beats coalesce into one presence timeline

  @EARS-5 @happy
  Scenario: The captured data yields per-doctor minutes sufficient for the manual sponsor export
    Given a live room that captured heartbeats from several doctors
    When the operator derives presence minutes over the cadence N
    Then each doctor has actual presence minutes computed from the beats
    And the data is sufficient to produce the sponsor report by manual export
    And no report UI is required in wave 1

  @EARS-5 @edge
  Scenario: Changing the heartbeat cadence changes config, not spec or code
    Given the presence minutes computed at the default cadence of 60 seconds
    When an operator confirms a different cadence and updates the server config
    Then the presence minutes recompute over the new cadence
    And no spec or code change is required

  @EARS-5 @happy
  Scenario: The in-room counter reflects another doctor's presence in realtime
    Given two doctors are live in the same open room
    And an observer is watching the room without posting a new heartbeat
    When a second doctor joins or leaves and the distinct-doctor count changes
    Then the api publishes the recomputed count to the room's realtime channel
    And the observer's in-room counter reflects the change within about one second
    And no beat from the observer's own client is required for the update

  @EARS-5 @edge
  Scenario: The counter degrades to the heartbeat-ack cadence when the realtime channel is down
    Given the room's realtime channel is unavailable
    When the distinct-doctor count changes
    Then the observer's counter falls back to the heartbeat-ack refresh path
    And the counter updates at the beat cadence rather than instantly
    And the counter never freezes silently on a stale value

  # --- Denied-access routing (US-1, US-5) ---

  @EARS-6 @failure
  Scenario Outline: An unadmissible caller is routed truthfully, never shown a soft wall
    Given a caller who is "<condition>" for a room
    When the caller reaches the room
    Then the caller is routed to "<destination>"
    And no soft UI wall renders the player

    Examples:
      | condition                     | destination                                  |
      | unauthenticated               | the auth flow (feature 003), then re-evaluated |
      | authenticated but unregistered| register for the event (feature 005)         |
      | on an event that is not live  | the truthful lifecycle state (feature 004)   |

  # --- Room close stops capture (US-3, US-4) ---

  @EARS-7 @happy
  Scenario: Closing the room stops heartbeat and chat acceptance
    Given a live room with a doctor present
    When the director closes the room and the event leaves the live state
    Then a late heartbeat for that event is refused
    And a late chat post for that event is refused
    And the room degrades to the truthful ended state
    And the doctor's minutes are computed over the window the room was open

  # --- Cross-cutting (US-5, US-1) ---

  @EARS-8 @failure
  Scenario: A doctor cannot read another doctor's room data or the roster
    Given two doctors and a live event one of them is registered for
    When the other doctor requests the room config, chat identity, presence, or roster of the first
    Then no other doctor's room data is returned
    And the room config, chat, and heartbeat endpoints require authentication and registration

  @EARS-8 @failure
  Scenario: The presence data is never exposed on a public surface
    Given a live event with captured presence beats
    When any public endpoint is requested
    Then no per-doctor presence data or registrant PII is returned

  @EARS-9 @happy
  Scenario: The room embeds the stream as a frame only
    Given a gated doctor in a live room
    When the room renders the external stream
    Then the stream is embedded as a configured frame only
    And the room does not transcode, re-host, proxy, DRM-sign, record, or telemeter the stream

  @EARS-10 @happy
  Scenario: Absolute room times render in МСК regardless of the viewer's timezone
    Given a viewer whose browser timezone is not Europe/Moscow
    When the viewer opens the «О эфире» program in the room
    Then every absolute date and time is presented in Europe/Moscow labeled МСК
    And no time drifts to the viewer's local timezone

  @EARS-11 @happy
  Scenario Outline: The room renders to the vendored canvas at both breakpoints and themes
    Given a gated doctor's live room
    When it renders at the "<breakpoint>" breakpoint in the "<theme>" theme
    Then the layout matches the vendored neo-brutalist webinar-room canvas geometry
    And no arbitrary Tailwind value is used (token-lint green)

    Examples:
      | breakpoint | theme |
      | desktop    | light |
      | desktop    | dark  |
      | mobile     | light |
      | mobile     | dark  |

  # --- Room theme: header toggle + portal-wide mechanism (US-6) ---

  @EARS-12 @happy
  Scenario: The header toggle switches the theme and the choice persists across reloads
    Given a gated doctor in a live room rendered in the light theme
    When the doctor activates the room-header theme toggle
    Then the portal switches to the dark theme by toggling the .dark class on the html element
    And the header icon-button reflects the dark state with its glyph and aria-pressed
    When the doctor reloads the room
    Then the room renders in the dark theme from first paint
    And the page never flashes the wrong theme

  @EARS-12 @happy
  Scenario: With no stored choice the theme follows the system preference, and an explicit choice wins
    Given a doctor with no persisted theme choice whose system prefers the dark scheme
    When the doctor opens the room
    Then the room renders in the dark theme
    When the doctor explicitly selects the light theme with the header toggle
    Then the room renders in the light theme on this and every later visit
    And the persisted choice wins over the system preference

  @EARS-13 @happy
  Scenario: The portal accessibility sweep covers both themes
    Given the portal axe end-to-end sweep
    When it drives its covered surfaces in the light and the dark theme
    Then the dark rendering introduces no new accessibility violations relative to light

  # --- Display name & avatar: JIT collection, named chat authorship (US-7) ---

  @EARS-14 @happy
  Scenario: The first room entry asks once for the doctor's name
    Given a gated doctor whose display name is not set
    When the doctor enters a live room for the first time
    Then the portal prompts once for «Имя и фамилия» before rendering the room
    And the prompt discloses that the name is shown to other chat participants
    When the doctor submits a real name
    Then the trimmed name is saved to the doctor's user record via the authenticated endpoint
    And the room renders
    And no later room entry shows the prompt again

  @EARS-14 @failure
  Scenario: An empty or whitespace-only name is rejected
    Given the one-time name prompt before a doctor's first room entry
    When the doctor submits an empty or whitespace-only value
    Then the value is rejected with a truthful error
    And the room does not render until a real name is saved

  @EARS-15 @happy
  Scenario: The room header avatar shows the initials of the real saved name
    Given a gated doctor with a saved display name
    When the room renders
    Then the header avatar shows the initials derived from the saved name
    And the initials are never fabricated from an email address or a placeholder profile

  @EARS-16 @failure
  Scenario: The self-profile display-name read is served only to its owner
    Given two doctors in the same live room, one of them with a saved display name
    When the other doctor requests that name through a profile read
    Then no profile-read endpoint returns another doctor's display name
    And the Zitadel profile placeholder stays never-read

  @EARS-17 @happy
  Scenario: A chat message carries the poster's own display name to every participant
    Given two doctors in the same live room, the poster with a saved display name
    When the poster sends a chat message
    Then the fanned-out payload carries the poster's own display name in the authorName field
    And every participant sees that name as the message author
    And the name carried is only the poster's own saved name, never fabricated from an email or a placeholder

  @EARS-17 @failure
  Scenario: A poster with no display name falls back to the non-PII participant tag
    Given a gated doctor with no display name set posts in a live room
    When the message fans out to the other participants
    Then the payload authorName is null
    And the portal renders the non-PII «Участник <tag>» participant label instead of a fabricated name
    And a legacy message minted before the authorName field existed renders the same tag fallback

---
"@ds/portal": patch
---

In-room player failure states — watchdog + truthful status + bounded retry (006 EARS-18, #1162).

A webinar stream that mounts but never starts playing (a provider CDN-edge stall, an
embedding-disabled video) no longer leaves the doctor staring at a silent black
frame. The room runs a provider-agnostic **watchdog** (a cross-origin iframe is
opaque, and `iframe.onload` fires even on a provider error page, so it is never a
success signal), and grades a stall so the status is never untruthful:

- **CONFIRMED** — an observed provider error, or a stall AFTER the provider handshake
  was established (a real signal loss). The room covers the embed with a specific
  truthful overlay, **auto-retries a bounded number of times** (`PLAYER_MAX_AUTO_RETRIES`),
  then offers an in-room **«Перезапустить плеер»**.
- **SUSPECTED** — a watchdog stall with no positive signal ever seen (vk + cdnvideo
  always — no parent API; youtube/rutube when no handshake arrived). The room can NOT
  prove the stream failed, so it shows a **non-covering advisory banner** beside the
  still-visible, still-interactive embed and does **not** auto-retry (an auto re-create
  would interrupt a possibly-healthy stream) — manual restart only.

Both remedies stay in the room — **never** a full page reload, **never** an off-platform
link. Where a provider exposes a parent-observable API the room layers its signals on
top: **youtube** (IFrame Player API) establishes the handshake, clears the watchdog on
the playing state, and maps `onError` to distinct copy — 101/150 «встраивание отключено
владельцем» vs 100 «видео недоступно»; **rutube** (postMessage JSON API) establishes on
`player:ready`, clears on `player:changeState(playing)`, surfaces a generic confirmed
failure on `player:error`. A playing signal at any point clears the status (provider
self-heal / CDN failover). Presence capture (EARS-4/5) is fully decoupled — a
failed/retrying/suspected player never pauses or resets the heartbeat.

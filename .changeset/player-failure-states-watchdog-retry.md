---
"@ds/portal": patch
---

In-room player failure states — watchdog + truthful status + bounded retry (006 EARS-18, #1162).

A webinar stream that mounts but never starts playing (a provider CDN-edge stall, an
embedding-disabled video) no longer leaves the doctor staring at a silent black
frame. The room now runs a provider-agnostic **watchdog** (a cross-origin iframe is
opaque, and `iframe.onload` fires even on a provider error page, so it is never a
success signal); if no playing signal arrives within `PLAYER_WATCHDOG_MS` it raises a
truthful in-frame status overlay, **auto-retries the embed a bounded number of times**
(`PLAYER_MAX_AUTO_RETRIES`), then offers an in-room **«Перезапустить плеер»** that
re-creates the embed — **never** a full page reload, **never** an off-platform link.

Where a provider exposes a parent-observable API the room layers its signals on top:
**youtube** (IFrame Player API) clears the watchdog on the playing state and maps
`onError` to distinct copy — 101/150 «встраивание отключено владельцем» vs 100 «видео
недоступно»; **rutube** (postMessage JSON API) clears on `player:changeState(playing)`
and surfaces a generic failure. **vk** (live) and **cdnvideo** are watchdog-only, a
stated provider capability constraint. A playing signal at any point clears the
overlay (provider self-heal / CDN failover). Presence capture (EARS-4/5) is fully
decoupled — a failed/retrying player never pauses or resets the heartbeat.

---
"@ds/room": patch
---

006 EARS-18 — «Перезапустить плеер» no longer stands over a stream that is
playing. A VK live embed talks to its parent only when the embed src carries
`js_api=1`; the room built the src without it, so it observed nothing, the
watchdog fired on a perfectly healthy broadcast and the doctor saw «Похоже,
трансляция не загружается» plus a restart control on top of playing video.
Every vk src is now built with `js_api=1`, and vk is a parent-observable
provider: its `inited` handshake, `started` and recurring `timeupdate`
(`state: "playing"` / `"unstarted"`) signals are parsed under a strict
`https://vk.com` origin guard and clear the watchdog. VK carries no error
event, so none is ever synthesized — a vk stall is still graded by the
watchdog alone.

CDNvideo stays permanently unobservable (its bundles emit no parent message at
all), so its suspected-grade advisory is now time-boxed: after
`PLAYER_ADVISORY_TIMEBOX_MS` (~60 s) the banner withdraws itself into the new
`unverified` state, leaving only a low-emphasis «Перезапустить плеер» that
re-creates the embed on an explicit doctor gesture — never on a timer. The
time box is cdnvideo-only: a failed youtube/rutube/vk handshake keeps its
banner, because for those a real signal can still arrive.

---
"@ds/doctor": minor
"@ds/api": minor
---

020 §6.1 / 006 EARS-2 (#1722 slice 3) — the doctor storefront mounts the shared live room at `/events/:slug/room`.

The room is the same `@ds/room` unit the Academy runs, not a second implementation: this host adds only its session forward, its own upstream base, its own route table (all three refusal branches stay on doctor.school — this host has no login route) and its own RU copy. The route lives in a new `(room)` group so it renders outside the 017 storefront chrome.

The api's doctor route table now resolves `roomPath`, so a registered doctor on a live event gets `enter-room` with a real target on doctor.school instead of the `href: null` it carried while the route did not exist.

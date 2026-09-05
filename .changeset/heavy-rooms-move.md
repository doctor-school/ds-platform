---
"@ds/portal": patch
"@ds/room": patch
---

Room composition moved into `@ds/room/ui`: the six room components, the presence channel and the two server reads now live in the shared package, parameterised on a host-injection contract (copy, room API, link component + routes, user-cluster slot). The academy route at `/webinars/[slug]/room` is re-seated as a thin server host projection over `RoomShell` with no render delta.

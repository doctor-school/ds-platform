---
"@ds/room": patch
---

006 EARS-7 (#1974): an open room whose эфир is closed shows the end card instead of «Трансляция не загружается / Переподключаемся…» — a player failure re-probes the room status at once through the existing heartbeat, so the close no longer waits for the next scheduled beat.

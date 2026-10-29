---
"@ds/room": patch
---

006 EARS-7 (#1974): an open room whose эфир is closed shows the end card instead of «Трансляция не загружается / Переподключаемся…» — a player failure re-probes the room status at once through the existing heartbeat, so the close no longer waits for the next scheduled beat.

006 EARS-7 (#3468): in the ended room the «Мои события» words of the end card link to the host's «Мои события» page (`RoomRoutes.accountEvents`, from each host's `routes.accountEvents`), and an ended chat with no messages reads «В этом эфире сообщений не было.» instead of the live room's promise that the chat will open.

---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
"@ds/learning": minor
"@ds/admin": minor
---

023 EARS-1 / EARS-2 / EARS-27 / EARS-28 (#4282): a module's club and the module reward. `PATCH /v1/admin/learning/modules/{id}` takes `clubEventId` (a live 020 event, `null` turns the club off; an unknown or removed event is refused naming the field) and the admin module read carries `clubEventId` with the event's title and start. The 024 rule setting `module.reward` (`points` | `document` | `both`, platform default `points`) is set at the course and the module layers through the existing rules endpoints; on a published course its change takes `learning_rules_editor`. Migration 0079 adds `learning_modules.club_event_id` and the platform seed value. In the admin the course editor picks, shows (title and Moscow start), changes and clears each module's club through the events picker, and the rules editor offers «Награда за модуль» as a choice («Баллы», «Документ», «Баллы и документ») at the course and module scopes.

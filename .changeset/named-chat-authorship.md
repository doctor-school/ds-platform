---
"@ds/schemas": major
"@ds/api": minor
"@ds/portal": minor
---

feat(006): show viewer display names in the webinar-room live chat (EARS-17, #1121)

A chat message now carries the poster's own display name so every participant sees who is speaking, instead of the anonymized «Участник <tag>» label (owner decision 2026-07-23, Option A — a reversal of the earlier «visible only to you» stance for names collected under the JIT room-entry prompt).

- **`@ds/schemas`** (major — chat-identity field-semantics change): `RoomChatMessageSchema` gains `authorName: z.string().min(1).nullish()`. The field is **nullish** (nullable + optional) so a poster with no name set carries `null` and legacy history minted before the field existed (the key absent) still parses — the portal coalesces both to the tag fallback. No migration/backfill; the `users.display_name` column already ships (EARS-14).
- **`@ds/api`**: the `PostChatMessage` path resolves the poster's own `display_name` alongside their `authorTag` and stamps it into the fanned-out payload; `authorName: null` when unset — never a name fabricated from email/roster identity. The stable non-PII `authorTag` still rides every payload as the self-identity key.
- **`@ds/portal`**: the chat row renders the author's real name for others, «Вы» for the reader's own message, and «Участник <tag>» when `authorName` is null/absent. The JIT «Имя и фамилия» prompt copy now discloses «Ваше имя будут видеть участники чата эфира», replacing the old «видно только вам» promise.

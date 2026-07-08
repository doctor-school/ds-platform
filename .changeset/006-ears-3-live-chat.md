---
"@ds/schemas": minor
"@ds/api": minor
"@ds/portal": minor
---

feat(room): 006 EARS-3 — live chat over Centrifugo (gated read + real-time post)

Where the room is open, a gated doctor reads the live chat and posts messages that
fan out to every participant in real time without a reload, over the room channel
keyed by event id (feature 006, EARS-3; realizes US-2). Chat rides Centrifugo,
already in the stack — 006 adds a `room:event:<id>` channel + a gate-scoped,
subscribe-only connection token, not a new transport.

- `@ds/schemas` — the room DTOs grow additively: `RoomConfig.chat`
  (`{ url, token, channel, selfTag } | null`, the subscribe-only Centrifugo
  credential), `PostChatMessageRequest` (`{ text }`, validated by the
  `ChatMessageTextSchema` SSOT — trimmed, non-empty, ≤2000), the published
  `RoomChatMessage` (`{ id, authorTag, text, at }` — PII-free), and
  `PostChatMessageAck`.
- `@ds/api` — `POST /v1/events/:idOrSlug/chat` (`PostChatMessage`), behind the
  **same** admission gate as EARS-1 (`authenticated ∧ registered ∧ live`): the
  backend authorizes, then publishes to Centrifugo over the HTTP API — the **only**
  publish path. The `RoomConfig` grant carries a connection JWT whose `channels`
  claim is gate-scoped to exactly the caller's room channel and grants **no**
  publish capability, so a client can never publish directly. A guest (401),
  unregistered (403), or non-`live` (409) caller publishes nothing (EARS-8); a
  Centrifugo outage is a 503. Author identity is a non-reversible, non-PII tag
  (`authorTag`), never the roster identity. Classified `authenticated` /
  `doctor_guest` / `policy` in the endpoint-authz matrix. Config (`CENTRIFUGO_*`)
  is read from env; unconfigured ⇒ `chat: null` (fail-closed).
- `@ds/portal` — the room's chat aside is now live: it subscribes over Centrifugo
  (`centrifuge`, MIT) and renders others' messages in real time without a reload,
  and the composer posts through the gated command. The composer enforces the same
  `ChatMessageTextSchema` reject rule as the server (empty / whitespace-only stays
  unsendable). All copy resolves through the typed message catalog (EARS-10); built
  from `@ds/design-system` tokens (EARS-11).

Room-close refusal of posts (EARS-7, #583) and the full both-breakpoints × both-
themes fidelity + Stage-B live confirmation (#584) are tracked separately.

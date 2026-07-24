import { z } from "zod";
import { StreamConfigSchema } from "./events.schema.js";

// 006 — Webinar-room contracts (API SSOT, ADR-0002 §3, ADR-0006 §6.2).
// Framework-agnostic; `apps/api` wraps these at the I/O boundary and the portal
// consumes the same types via the generated SDK. This file covers the EARS-1
// server-side admission gate (the `RoomAccess` grant a caller receives ONLY when
// authenticated ∧ registered ∧ live) and the EARS-2 embed player (the explicit
// provider enum + embed reference the grant carries). The Centrifugo chat token
// (EARS-3) and the heartbeat capture loop + durable presence table (EARS-4) are
// sibling handlers that extend this read model ADDITIVELY; EARS-1 owns the gate
// and the grant vehicle.

/**
 * `RoomChatCredential` — the gate-scoped, **subscribe-only** Centrifugo access the
 * `RoomConfig` grant carries so a gated doctor can READ the live chat (EARS-3;
 * design §4). It is minted server-side ONLY for a caller the admission gate
 * admitted, and it is deliberately NOT a publish capability:
 *
 * - `token` is a Centrifugo connection JWT (HS256, HMAC) whose `channels` claim
 *   lists **exactly** this caller's room channel — Centrifugo subscribes the
 *   connection to it SERVER-SIDE on connect, so the token grants read of this one
 *   room and nothing else (gate-scoped: a doctor gated for event A cannot use it
 *   to read event B). It carries **no** publish capability — the `room` namespace
 *   keeps `allow_publish_for_client` off, so a client can never publish directly.
 * - `channel` is the room channel (`room:event:<id>`) the client listens on.
 * - `url` is the Centrifugo **websocket** endpoint the browser connects to (read
 *   from `CENTRIFUGO_URL`, never hardcoded — requirements Constraints).
 * - `selfTag` is the caller's own non-PII author tag, so the client can mark its
 *   own messages without the server ever leaking another doctor's identity beyond
 *   the tag chat legitimately shows (EARS-8).
 *
 * Posting is **server-mediated**: a message is sent through the gated
 * `PostChatMessage` command (below), never with this credential. This keeps the
 * post path behind the same server-side gate as everything else (design §4).
 */
export const RoomChatCredentialSchema = z.object({
  url: z.string().min(1),
  token: z.string().min(1),
  channel: z.string().min(1),
  selfTag: z.string().min(1),
});
export type RoomChatCredential = z.infer<typeof RoomChatCredentialSchema>;

/**
 * `RoomConfig` — the server-issued `RoomAccess` grant payload (design §2, §7).
 * Served by `GET /v1/events/:idOrSlug/room` **only** to a caller the server-side
 * gate admits — authenticated AND registered for the event (005 `EventRoster`)
 * AND the event `live`. A guest, an unregistered doctor, or a non-`live` event is
 * refused server-side (401 / 403 / 409) and never receives this body — there is
 * no soft UI wall that renders the room for an ungated caller (EARS-1, EARS-8).
 *
 * The EARS-1 grant carries the room identity (`eventId`) and the server-config
 * heartbeat cadence `heartbeatIntervalSeconds` (N, the value the client's later
 * presence loop is driven by — the loop itself and the durable append table are
 * the EARS-4 sibling). The Centrifugo chat credential (EARS-3) is added to this
 * shape ADDITIVELY by its handler — the schema is the growing SSOT, never a re-cut
 * per slice.
 *
 * `stream` (EARS-2) is the embed player's source, resolved from the event's
 * 007-authored stream config: the **explicit provider enum** (`rutube | youtube`)
 * + the provider-scoped `embedRef`, reusing the {@link StreamConfigSchema} SSOT
 * (never redefined here). The room switches the player on `provider` and NEVER
 * sniffs the URL (the legacy mistake, requirements Constraints). It is
 * **nullable**: a gated caller for a `live` event whose stream config is absent
 * or carries an unknown provider still receives a valid grant (the gate passed)
 * with `stream: null` — the portal renders the truthful "stream unavailable" room
 * state rather than a guessed embed (design §3).
 *
 * `chat` (EARS-3) is the gate-scoped subscribe-only chat credential. It is
 * **nullable** on the same fail-closed principle: when Centrifugo is not
 * configured (no `CENTRIFUGO_URL` / API key / token secret — the shared-CI /
 * Centrifugo-less default, mirroring the IdP / Redis / S3 fakes) the grant is
 * still valid (the gate admitted the caller) with `chat: null`, and the portal
 * renders the truthful "chat unavailable" state rather than a broken connection.
 * On the dev-stand and in production Centrifugo is configured, so `chat` is
 * present for every live room.
 */
/**
 * `liveAt` (EARS-10 live-elapsed indicator) is the **actual go-live instant** the
 * director opened the room at (007 `OpenRoom`, the `published → live` transition),
 * so the room's «В эфире · N мин» pill counts elapsed minutes from the moment the
 * broadcast actually started — never from the *scheduled* `startsAt` (a late start
 * must not show inflated minutes). It is **nullable**: a `live` event whose go-live
 * instant predates the column (a legacy row) still receives a valid grant with
 * `liveAt: null`, and the room renders the pill with **no** minute suffix (truthful,
 * never back-filled from the schedule).
 *
 * `presenceCount` (the canvas «N врачей в комнате» indicator) is the **live count of
 * distinct doctors currently in the room** — the number of distinct users who
 * emitted a presence beat within the freshness window (≈ `2 ×
 * heartbeatIntervalSeconds`, so a doctor who missed one beat still counts, but one
 * who left ages out within two cadences). It is a server-side **aggregate** derived
 * at read time over the same append-only `presence_beats` the EARS-5 minutes draw
 * from — an integer, never a per-doctor identity or the roster, so it leaks no PII
 * (EARS-8: aggregate presence ≠ another doctor's presence data). It is the initial
 * value the client renders; each heartbeat ack refreshes it (below). `0` is valid
 * (the first doctor in an empty room; the beat this read follows makes it ≥ 1).
 */
export const RoomConfigSchema = z.object({
  eventId: z.uuid(),
  heartbeatIntervalSeconds: z.number().int().positive(),
  liveAt: z.iso.datetime({ offset: true }).nullable(),
  presenceCount: z.number().int().nonnegative(),
  stream: StreamConfigSchema.nullable(),
  chat: RoomChatCredentialSchema.nullable(),
});
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

/**
 * The chat-message text validator (EARS-3) — the SINGLE SSOT rule the portal
 * composer and the `PostChatMessage` command both enforce, so a client can never
 * post what the server would reject and the reject path is identical on both
 * sides. Trimmed (leading/trailing whitespace is not content), non-empty after
 * trim (a whitespace-only message is rejected — the garbage-input reject path),
 * and bounded at 2000 chars (a chat line, not a document). `.trim()` normalises
 * before the length checks so the persisted/published text carries no padding.
 */
export const ChatMessageTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000);

/**
 * `PostChatMessage` request body (EARS-3) — the gated command's only input. The
 * `idOrSlug` room identity is the path parameter (not the body); the body carries
 * only the `text`, validated by the {@link ChatMessageTextSchema} SSOT so a
 * malformed post is a 400 before the handler runs (nestjs-zod at the boundary).
 */
export const PostChatMessageRequestSchema = z.object({
  text: ChatMessageTextSchema,
});
export type PostChatMessageRequest = z.infer<
  typeof PostChatMessageRequestSchema
>;

/**
 * `RoomChatMessage` — the shape fanned out over the room channel and echoed to the
 * poster in the command ack (EARS-3; design §4). Server-authoritative: `id` + `at`
 * are server-minted (a client cannot forge a message id or backdate a post) and
 * `text` is the validated content.
 *
 * Author identity carries two server-authoritative fields (EARS-17): `authorName`
 * is the poster's own display name (`users.display_name`) — the same name the
 * doctor entered at the JIT room-entry prompt, shown to every participant in the
 * live chat — and `authorTag` is the stable, non-reversible tag derived from the
 * doctor's domain id. `authorName` is `null` when the poster has no display name
 * set, and **absent** on legacy history minted before this field existed — the
 * field is therefore **nullish** (`null | undefined`) so a stored legacy payload
 * still parses (Centrifugo `history` re-validates every publication and a required
 * key would silently drop the legacy message from the hydrated pane); the portal
 * coalesces both `null` and a missing key to the `authorTag` participant label
 * (EARS-17). The tag remains the stable self-identity key the poster's client
 * matches its own `selfTag` against.
 */
export const RoomChatMessageSchema = z.object({
  id: z.uuid(),
  authorTag: z.string().min(1),
  authorName: z.string().min(1).nullish(),
  text: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
});
export type RoomChatMessage = z.infer<typeof RoomChatMessageSchema>;

/**
 * `PostChatMessage` acknowledgement (EARS-3) — returned by
 * `POST /v1/events/:idOrSlug/chat` **only** to a caller the same server-side gate
 * admits (authenticated ∧ registered ∧ live); an ungated caller is refused
 * (401 / 403 / 409) and no message is published (EARS-8), exactly like the
 * `RoomConfig` read and the heartbeat command. The ack echoes the resolved room
 * identity and the server-authoritative {@link RoomChatMessage} that was published
 * to the channel — the poster's own client renders it immediately without waiting
 * for the fan-out round-trip.
 */
export const PostChatMessageAckSchema = z.object({
  eventId: z.uuid(),
  message: RoomChatMessageSchema,
});
export type PostChatMessageAck = z.infer<typeof PostChatMessageAckSchema>;

/**
 * `RoomPresenceCountMessage` — the server-authoritative live presence count fanned
 * out over the room channel in realtime (EARS-5; design §5 "Realtime presence-count
 * push"). It rides the SAME `room:event:<id>` channel as the chat fan-out (the
 * already-provisioned, subscribe-only credential the `RoomConfig` grant carried) —
 * no dedicated presence channel, no second credential — and is discriminated from a
 * {@link RoomChatMessage} client-side by the `type` literal (a chat message carries
 * no `type` key, so the two never cross-parse).
 *
 * The api publishes one of these ONLY when an accepted beat, or a presence-window
 * expiry, **changes** the distinct-doctor count (no publish on an unchanged count),
 * so a subscribed client renders the new value instantly — without waiting on its
 * own next heartbeat. `count` is the same server-side aggregate the grant seeds and
 * every heartbeat ack carries — a bare integer, never a per-doctor identity or the
 * roster (EARS-8). While the realtime channel is unavailable the portal degrades to
 * the heartbeat-ack refresh path (#1136); this message is the fast path, never the
 * only path.
 */
export const RoomPresenceCountMessageSchema = z.object({
  type: z.literal("presence-count"),
  count: z.number().int().nonnegative(),
  at: z.iso.datetime({ offset: true }),
});
export type RoomPresenceCountMessage = z.infer<
  typeof RoomPresenceCountMessageSchema
>;

/**
 * `PresenceHeartbeatAck` — the acknowledgement of one accepted presence beat
 * (EARS-4; design §5, §7). Returned by `POST /v1/events/:idOrSlug/heartbeat`
 * **only** to a caller the same server-side gate admits (authenticated ∧
 * registered ∧ live) — an ungated caller is refused (401 / 403 / 409) and never
 * receives this body, exactly like the `RoomConfig` read (EARS-1, EARS-8).
 *
 * Each accepted beat appends exactly one immutable row `(doctor, event, instant)`
 * to the durable append-only presence table (ADR-0003 §3) — the durable basis
 * for the per-doctor sponsor minutes (EARS-5 derives them, parameterized over N,
 * concurrent-tab-coalesced). The ack is **server-authoritative**: `eventId` is the
 * resolved room identity and `beatAt` is the **server-stamped** canonical instant
 * the row was appended at — never a client-supplied count or timestamp (a client
 * cannot inflate its own presence; requirements Constraints "server-authoritative
 * and durable"). It intentionally carries no minute total: the count/minutes are a
 * server-side derivation over the append table, never a value the client is told
 * or trusted with.
 */
export const PresenceHeartbeatAckSchema = z.object({
  eventId: z.uuid(),
  beatAt: z.iso.datetime({ offset: true }),
  /**
   * The live room-presence count **after** this beat was appended — the count of
   * distinct doctors with a beat inside the freshness window (≈ `2 × N`), the same
   * server-side aggregate the `RoomConfig` grant seeds `presenceCount` with. The
   * client refreshes the header's «N врачей в комнате» indicator from it on every
   * beat, so the count tracks doctors joining and ageing out without a separate
   * poll. An aggregate integer only — never a per-doctor identity, presence detail,
   * or the roster (EARS-8). It is ≥ 1 in this ack (this caller's own just-appended
   * beat is inside the window).
   */
  presenceCount: z.number().int().nonnegative(),
});
export type PresenceHeartbeatAck = z.infer<typeof PresenceHeartbeatAckSchema>;

/**
 * `DoctorPresenceMinutes` — one doctor's derived presence for an event (EARS-5;
 * design §5). The per-doctor `{ doctor, event, minutes }` unit the sponsor
 * report draws from:
 *
 * - `userId` is the doctor's opaque domain id (the 003 `users` mirror row the
 *   beats attribute to) — **never** a registrant's email / phone / roster
 *   identity, so the derivation carries no PII onto any surface (EARS-8).
 * - `eventId` is the event the minutes were captured for.
 * - `minutes` are **derived**, not stored: `(distinct N-second buckets the doctor
 *   emitted a beat in) × N / 60` over the durable append-only `presence_beats`
 *   (design §5). Concurrent tabs coalesce into one presence timeline (two tabs in
 *   the same bucket count once), so the value never inflates past real covered
 *   time; it is `nonnegative` (a doctor with no beats does not appear at all).
 *
 * There is no minute count in the durable table — the value is a server-side
 * read-time derivation, never a client-supplied or client-trusted number
 * (requirements Constraints "server-authoritative and durable").
 */
export const DoctorPresenceMinutesSchema = z.object({
  userId: z.uuid(),
  eventId: z.uuid(),
  minutes: z.number().nonnegative(),
});
export type DoctorPresenceMinutes = z.infer<typeof DoctorPresenceMinutesSchema>;

/**
 * `EventPresence` — the per-event presence read model (EARS-5; design §5, read
 * models). The set of per-doctor minutes derived from the append-only beats,
 * **parameterized over N**: `intervalSeconds` is the heartbeat cadence the
 * minutes were computed at (the server config `ROOM_HEARTBEAT_INTERVAL_SECONDS`
 * by default), so an operator-confirmed different cadence recomputes the SAME
 * beats with no code change (owner decision 2026-07-06). `doctors` carries only
 * the doctors who emitted at least one beat.
 *
 * This is the shape the **wave-1 manual sponsor export** reads — there is **no**
 * report UI and **no** public endpoint in wave 1 (EARS-5); the derivation is
 * produced by a standalone ops read (`RoomModule` `PresenceDerivationService`,
 * surfaced by the `presence:export` CLI) and is **never** exposed on a public
 * surface (EARS-8). The wave-2 auto report «Отчёт партнёра V2» + auto-NMO consume
 * this same derivation; the exact V2 columns/joins are a wave-2 owner call.
 */
export const EventPresenceSchema = z.object({
  eventId: z.uuid(),
  intervalSeconds: z.number().int().positive(),
  doctors: z.array(DoctorPresenceMinutesSchema),
});
export type EventPresence = z.infer<typeof EventPresenceSchema>;

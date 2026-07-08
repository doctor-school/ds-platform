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
 * the EARS-4 sibling). The Centrifugo chat token (EARS-3) is added to this shape
 * ADDITIVELY by its handler — the schema is the growing SSOT, never a re-cut per
 * slice.
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
 */
export const RoomConfigSchema = z.object({
  eventId: z.uuid(),
  heartbeatIntervalSeconds: z.number().int().positive(),
  stream: StreamConfigSchema.nullable(),
});
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

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
});
export type PresenceHeartbeatAck = z.infer<typeof PresenceHeartbeatAckSchema>;

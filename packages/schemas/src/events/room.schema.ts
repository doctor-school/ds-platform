import { z } from "zod";

// 006 — Webinar-room contracts (API SSOT, ADR-0002 §3, ADR-0006 §6.2).
// Framework-agnostic; `apps/api` wraps these at the I/O boundary and the portal
// consumes the same types via the generated SDK. This file covers the EARS-1
// server-side admission gate: the `RoomConfig` a caller receives ONLY when the
// server has issued a `RoomAccess` grant (authenticated ∧ registered ∧ live).
// The provider enum + embed reference (EARS-2), the Centrifugo chat token
// (EARS-3), and the heartbeat capture loop + durable presence table (EARS-4) are
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
 * the EARS-4 sibling). The player provider enum + embed reference (EARS-2) and
 * the Centrifugo chat token (EARS-3) are added to this shape ADDITIVELY by their
 * handlers — the schema is the growing SSOT, never a re-cut per slice.
 */
export const RoomConfigSchema = z.object({
  eventId: z.uuid(),
  heartbeatIntervalSeconds: z.number().int().positive(),
});
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

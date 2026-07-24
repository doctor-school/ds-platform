import { RoomPresenceCountMessageSchema } from "@ds/schemas";

/**
 * 006 EARS-5 — route ONE room-channel publication to the live presence count.
 *
 * The realtime presence count rides the SAME `room:event:<id>` channel as chat (the
 * already-provisioned subscribe-only credential the `RoomConfig` grant carried), so
 * the room's single Centrifugo connection receives both. This is the discriminator:
 * a server-published {@link RoomPresenceCountMessageSchema} message (carrying the
 * `type: "presence-count"` literal) is applied to the header count and the call
 * returns `true`; anything else — a chat message, malformed data — is left for the
 * chat handler and returns `false` (the two shapes never cross-parse).
 *
 * On success the fresh count reaches {@link RoomPresenceProvider} INSTANTLY, without
 * the observer waiting on their own next heartbeat. While the channel is unavailable
 * no publication arrives and the count degrades to the heartbeat-ack refresh path
 * (#1136) — beat-paced, never silently frozen (the truthful-degradation contract).
 */
export function applyPresenceCountPublication(
  data: unknown,
  apply: (count: number) => void,
): boolean {
  const parsed = RoomPresenceCountMessageSchema.safeParse(data);
  if (!parsed.success) return false;
  apply(parsed.data.count);
  return true;
}

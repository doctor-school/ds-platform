/**
 * DI token for the server-side heartbeat cadence N (seconds) the `RoomConfig`
 * grant carries to the client (design §5 — "cadence N is server config, default
 * 60 s"). Bound in {@link RoomModule} from `ROOM_HEARTBEAT_INTERVAL_SECONDS`
 * (env.schema), so an operator-confirmed different cadence changes CONFIG, not
 * the spec or the code. The room service reads this rather than a hardcoded
 * constant. The client presence loop + the durable append table that consume N
 * are the EARS-4 sibling handler; EARS-1 only surfaces the configured value in
 * the grant.
 */
export const ROOM_HEARTBEAT_INTERVAL_SECONDS = Symbol(
  "ROOM_HEARTBEAT_INTERVAL_SECONDS",
);

/**
 * DI token for the resolved Centrifugo chat configuration (006 EARS-3, design
 * §4) — a {@link RoomChatConfig} or `null` when Centrifugo is not configured
 * (the shared-CI / Centrifugo-less default; chat degrades to the truthful
 * unavailable state). Bound in {@link RoomModule} from `CENTRIFUGO_*` env
 * (env.schema) via `resolveRoomChatConfig`, so the endpoint + keys are read from
 * config, never hardcoded. {@link CentrifugoChatGateway} consumes it to mint the
 * gate-scoped subscribe-only token and to publish over the HTTP API.
 */
export const ROOM_CHAT_CONFIG = Symbol("ROOM_CHAT_CONFIG");

/**
 * The freshness window (seconds) the live distinct-doctor presence count is
 * derived over: two heartbeat cadences (`2 × N`). A latest beat survives one
 * missed cadence, then ceases to count no later than `2 × N` if beats stop. This
 * count-only grace is not proof of physical presence and adds no sponsor minutes.
 *
 * It is a FUNCTION of the same server-config `N` ({@link
 * ROOM_HEARTBEAT_INTERVAL_SECONDS}) that drives the client loop, so an
 * operator-confirmed cadence change widens the window everywhere with no code
 * change (006 EARS-5). It lives here, next to the token, because THREE readers
 * now derive it — the room grant, the realtime publisher and the 020 participation
 * CTA — and three copies of `× 2` would be three chances for the count to
 * disagree with itself about who is still in the room.
 */
export function presenceWindowSeconds(
  heartbeatIntervalSeconds: number,
): number {
  return heartbeatIntervalSeconds * 2;
}

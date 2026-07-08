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

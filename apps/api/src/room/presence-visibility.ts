/**
 * 006 EARS-19 (#2911) — the ONE presence-count visibility rule, applied by the API
 * at every emission point: the room read and heartbeat ack (`room.service.ts`),
 * the room-entry CTA (`participation.service.ts`, 020 EARS-24) and the
 * «Идёт сейчас» strip (`events-live.service.ts`, 019 EARS-30). A caller receives
 * the live count when the event's «Показывать зрителям число участников» setting
 * is on, or when its session claims carry a staff role (`callerIsStaff`);
 * otherwise the count is `null` — never `0`, never a stale value. The realtime
 * push applies the same rule by channel (`presence-publisher.service.ts`).
 */
export function presenceVisibleTo(
  event: { showPresenceCount: boolean },
  staff: boolean,
): boolean {
  return event.showPresenceCount || staff;
}

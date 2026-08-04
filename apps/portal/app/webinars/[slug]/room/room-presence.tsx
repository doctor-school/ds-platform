"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

/**
 * 006 EARS-5 / EARS-10 — the room header's LIVE indicators, realizing the two
 * data-backed canvas header elements deferred by #584 (Issue #690):
 *
 * - **`PresenceCount`** («N врачей в комнате») renders distinct doctors whose
 *   latest accepted beat remains inside the count-only `2 × N` freshness window.
 *   It is a server-side aggregate, never physical-presence proof, per-doctor
 *   identity, or the roster (EARS-8); its grace adds no sponsor minutes. The grant
 *   seeds it, realtime publications update it, and heartbeat acks are the fallback.
 *   Desktop-only per the canvas (mobile is wordmark + pill + compact exit).
 * - **`LiveDuration`** (the «· N мин» suffix on the live pill) counts elapsed
 *   minutes from the event's ACTUAL go-live instant (`liveAt`, stamped by 007
 *   `OpenRoom`) — never the scheduled `startsAt`. A legacy live row with no `liveAt`
 *   renders no suffix (truthful, never back-filled from the schedule).
 *
 * All copy resolves through the typed message catalog (EARS-10) — Russian
 * pluralization for «врач/врача/врачей» via ICU `plural`; «мин» is the invariant
 * abbreviation (it does not inflect, so it is a plain interpolation, matching the
 * canvas «· 24 мин»).
 */

const PresenceContext = createContext<{
  count: number;
  setCount: (n: number) => void;
} | null>(null);

/**
 * Client context holding the live room-presence count. The EARS-1 grant seeds it,
 * Centrifugo room publications are the primary realtime fan-out, and heartbeat
 * acks are the fallback. The header's {@link PresenceCount} renders the shared
 * value without polling.
 */
export function RoomPresenceProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: ReactNode;
}) {
  const [count, setCount] = useState(initialCount);
  return (
    <PresenceContext.Provider value={{ count, setCount }}>
      {children}
    </PresenceContext.Provider>
  );
}

/** Read the live presence count (0 when no provider is mounted — inert). */
export function usePresenceCount(): number {
  return useContext(PresenceContext)?.count ?? 0;
}

/** Stable no-op so a provider-less mount keeps a referentially-stable setter (effect deps). */
const NOOP_SETTER = (): void => {};

/** Setter shared by Centrifugo publications and heartbeat-ack fallback (no-op without a provider). */
export function usePresenceCountSetter(): (n: number) => void {
  const ctx = useContext(PresenceContext);
  return ctx ? ctx.setCount : NOOP_SETTER;
}

/**
 * The «N врачей в комнате» live count (desktop header cluster, canvas line 21). It
 * renders nothing while the count is 0 — a lone doctor sees it appear as «1 врач…»
 * the moment their own first beat lands, never a «0 врачей» flash.
 */
export function PresenceCount({ className }: { className?: string }) {
  const t = useTranslations("room");
  const count = usePresenceCount();
  if (count <= 0) return null;
  return (
    <span data-testid="room-presence-count" className={className}>
      {t("presenceCount", { count })}
    </span>
  );
}

/** Whole elapsed minutes since `liveAtMs`, clamped at 0 (guards client/server clock skew). */
function elapsedMinutes(liveAtMs: number): number {
  return Math.max(0, Math.floor((Date.now() - liveAtMs) / 60_000));
}

/**
 * The «· N мин» live-duration suffix rendered INSIDE the live pill (canvas line 17,
 * «В эфире · 24 мин»). Counts from the actual go-live instant; re-renders on a
 * coarse 15 s tick (a minute counter needs no per-second churn). `null` `liveAt` →
 * no suffix at all (a legacy live row: truthful, never faked from the schedule).
 */
export function LiveDuration({ liveAt }: { liveAt: string | null }) {
  const t = useTranslations("room");
  const liveAtMs = liveAt ? Date.parse(liveAt) : NaN;
  const valid = Number.isFinite(liveAtMs);
  const [minutes, setMinutes] = useState(() =>
    valid ? elapsedMinutes(liveAtMs) : 0,
  );

  useEffect(() => {
    if (!valid) return;
    setMinutes(elapsedMinutes(liveAtMs));
    const timer = setInterval(
      () => setMinutes(elapsedMinutes(liveAtMs)),
      15_000,
    );
    return () => clearInterval(timer);
  }, [liveAtMs, valid]);

  if (!valid) return null;
  return (
    <span data-testid="room-live-duration">
      {t("liveDuration", { minutes })}
    </span>
  );
}

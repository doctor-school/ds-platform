"use client";

import { MOSCOW_TIME_ZONE } from "@ds/schemas";
import { useEffect, useState } from "react";

/**
 * The viewer's IANA zone for the event-time formatter (004 EARS-12 as amended,
 * 004-design §6.1 «Viewer zone»).
 *
 * The server never guesses a viewer zone, so the server render and the first
 * client render (the hydration pass) both read `Europe/Moscow` and agree; after
 * mount the hook swaps in the browser's resolved zone, and only online/hybrid
 * times re-format. A viewer in Moscow sees no change.
 */
export function useViewerZone(): string {
  const [zone, setZone] = useState<string>(MOSCOW_TIME_ZONE);
  useEffect(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved) setZone(resolved);
  }, []);
  return zone;
}

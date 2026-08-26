"use client";

import { useEffect, useState } from "react";
import { HeroCounters, type CountersState } from "@/components/hero-counters";
import { fetchScaleStatistics } from "@/lib/statistics";

/**
 * 017 EARS-2 — the ONE read behind the hero's four counters (LD-3), bound to the
 * render states of 017-design §6 row 1.
 *
 * A client component because §6 requires a «загрузка» skeleton and an «ошибка»
 * render that leaves the hero copy standing: both are states of a fetch that has
 * to happen AFTER the hero copy is already on screen. The copy itself is server
 * markup in `components/storefront-hero.tsx` and is not inside this boundary, so
 * a failing statistics read can never take the headline or the goal down with it.
 *
 * ONE read, not four: the counters are fields of a single computed response and
 * are never assembled from per-counter requests (LD-3).
 *
 * The effect aborts on unmount so a navigation away cannot resolve into a
 * detached tree; an abort is not an error state, it is no state at all.
 */
export function ScaleCounters() {
  const [state, setState] = useState<CountersState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchScaleStatistics(fetch, controller.signal)
      .then((statistics) => {
        if (!controller.signal.aborted) setState({ kind: "ready", statistics });
      })
      .catch(() => {
        // Every failure — transport, status, or a body that violates the shared
        // contract — is the same surface: counters omitted, hero intact. The
        // doctor is never shown a backend explanation, and never a zero.
        if (!controller.signal.aborted) setState({ kind: "error" });
      });

    return () => controller.abort();
  }, []);

  return <HeroCounters state={state} />;
}

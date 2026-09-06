"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { StreamProvider } from "@ds/schemas";
import {
  PLAYER_RETRY_DELAY_MS,
  PLAYER_WATCHDOG_MS,
  PROVIDER_HAS_PARENT_API,
  initialPlayerState,
  parseProviderSignal,
  playerReducer,
  type PlayerFailureKind,
  type PlayerGrade,
  type PlayerStatus,
} from "../model/room-player-state";

export interface PlayerFailureState {
  readonly status: PlayerStatus;
  /** CONFIRMED (covering overlay + auto-retry) vs SUSPECTED (advisory banner only). */
  readonly grade: PlayerGrade | null;
  readonly failure: PlayerFailureKind | null;
  /** Bump this as the iframe `key` — each change re-creates the embed (EARS-18.3). */
  readonly embedKey: number;
  /** The manual «Перезапустить плеер» affordance (EARS-18.3): re-create the embed. */
  readonly restart: () => void;
}

/**
 * 006 EARS-18 — the client hook wiring the {@link playerReducer} state machine to
 * real timers + provider postMessage events, for a mounted embed of `provider`.
 *
 * - **Watchdog (EARS-18.1).** Each `loading` (re)mount arms a `PLAYER_WATCHDOG_MS`
 *   timeout; elapsing with no playing signal fails to a truthful status — the
 *   provider-agnostic detection floor (a cross-origin iframe is opaque, and
 *   `iframe.onload` fires even on a provider error page, so it is never a success
 *   signal). The timeout is cleared on every status change (orphan-timer safe).
 * - **Provider events (EARS-18.2).** For youtube, rutube and vk (whose embed src
 *   carries `js_api=1`, #1314), a window `message` listener parses the provider's own
 *   signals ({@link parseProviderSignal}, origin-guarded) to clear the watchdog on
 *   `playing` and surface provider errors; cdnvideo registers no listener — it is
 *   structurally silent, so there is nothing to listen to.
 * - **Bounded retry (EARS-18.3).** On `retrying`, a `PLAYER_RETRY_DELAY_MS` timer
 *   re-creates the embed; the budget is bounded in the reducer.
 * - **Structurally silent providers (EARS-18.3).** cdnvideo exposes no parent API,
 *   so the hook mounts it in `unverified` and arms NO watchdog: the room states
 *   nothing about a stream it cannot observe and shows no advisory — only the
 *   gesture-gated restart, which re-creates the embed back into `unverified`.
 * - **Recovery (EARS-18.4).** A `playing` signal at any point clears the overlay.
 */
export function usePlayerFailureState(provider: StreamProvider): PlayerFailureState {
  const [state, dispatch] = useReducer(playerReducer, provider, initialPlayerState);
  const { status, grade, failure, embedKey, attempt } = state;

  // Watchdog — re-armed on every fresh load (a new embedKey or a return to loading).
  // The reducer grades the stall (SUSPECTED without a handshake, CONFIRMED with one).
  // A silent provider never reaches `loading`, so no watchdog is ever armed for it.
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => dispatch({ type: "watchdog" }), PLAYER_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [status, embedKey]);

  // Bounded auto-retry — a delayed embed re-creation while attempts remain.
  useEffect(() => {
    if (status !== "retrying") return;
    const timer = setTimeout(() => dispatch({ type: "retry" }), PLAYER_RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, attempt]);

  // Provider-event layering — only where the provider exposes a parent-observable API.
  useEffect(() => {
    if (!PROVIDER_HAS_PARENT_API[provider]) return;
    const handler = (event: MessageEvent) => {
      const signal = parseProviderSignal(provider, {
        origin: event.origin,
        data: event.data,
      });
      if (!signal) return;
      if (signal.kind === "playing") dispatch({ type: "playing" });
      else if (signal.kind === "ready" || signal.kind === "buffering")
        dispatch({ type: "handshake" });
      else if (signal.kind === "error") dispatch({ type: "error", failure: signal.failure });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [provider]);

  const restart = useCallback(() => dispatch({ type: "restart" }), []);
  return { status, grade, failure, embedKey, restart };
}

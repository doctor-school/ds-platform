import type { StreamProvider } from "@ds/schemas";

/**
 * 006 EARS-18 — the in-room player-failure state machine (watchdog + provider-event
 * layering + bounded in-room retry). Distinct from the config-absent EARS-2
 * "stream unavailable" state ({@link resolveEmbed}): this governs a stream that is
 * *configured and mounted* but never starts playing (the 2026-07-22 Rutube CDN-edge
 * timeout — an endless spinner in an opaque cross-origin iframe). `iframe.onload`
 * fires even on a provider error page, so it is NEVER a success signal; the only
 * universal detector is a wall-clock watchdog, with provider postMessage events
 * layered on top where a provider exposes a parent-observable API (design §3.1).
 */

/**
 * Watchdog threshold (EARS-18.1) — the wall-clock budget from an embed mount to the
 * first observed playing signal. Elapsing with no signal transitions
 * `loading → failed`. Named design constant (design §3.1, default ~20 s); the
 * detection floor that works even for providers that expose nothing to the parent.
 */
export const PLAYER_WATCHDOG_MS = 20_000;

/**
 * Bounded auto-retry budget (EARS-18.3) — the room re-creates the embed up to this
 * many times before surfacing the manual «Перезапустить плеер» affordance.
 */
export const PLAYER_MAX_AUTO_RETRIES = 2;

/** Delay between bounded auto-retry attempts (EARS-18.3). */
export const PLAYER_RETRY_DELAY_MS = 4_000;

/**
 * The runtime player state (design §3.1 state machine). `loading` covers the mount
 * window before the first playing signal (the provider renders its own spinner);
 * `failed`/`retrying` raise the truthful in-frame overlay; `playing` clears it.
 */
export type PlayerStatus = "loading" | "playing" | "failed" | "retrying";

/**
 * The failure classification that drives the overlay copy (EARS-18.2). `generic`
 * covers the watchdog floor and any provider error without a distinguishing code
 * (rutube `player:error` carries a message only; YouTube 153 referer; every
 * watchdog-only provider). YouTube alone distinguishes:
 * - `embedding-disabled` — codes 101 / 150 (broadcaster disabled embedding).
 * - `unavailable` — code 100 (video unavailable).
 */
export type PlayerFailureKind = "embedding-disabled" | "unavailable" | "generic";

/**
 * Which providers expose a parent-observable API for the LIVE embed (design §3.1
 * table). `youtube`/`rutube` do (postMessage); `vk` (`js_api` does not work for
 * live broadcasts) and `cdnvideo` (Clappr, same-origin script only) do NOT — those
 * are watchdog-only, a stated provider capability constraint, not a deferral.
 */
export const PROVIDER_HAS_PARENT_API: Record<StreamProvider, boolean> = {
  youtube: true,
  rutube: true,
  vk: false,
  cdnvideo: false,
};

/** The origin each provider's embed posts messages from (postMessage source guard). */
const PROVIDER_ORIGIN: Partial<Record<StreamProvider, string>> = {
  youtube: "https://www.youtube.com",
  rutube: "https://rutube.ru",
};

/**
 * EARS-18.2 — map a YouTube IFrame Player API `onError` code to the failure copy
 * class: 101/150 → embedding disabled by the broadcaster; 100 → video unavailable;
 * anything else (e.g. 153 referer / 2 invalid param) → generic "not loading".
 */
export function mapYouTubeErrorCode(code: number): PlayerFailureKind {
  if (code === 101 || code === 150) return "embedding-disabled";
  if (code === 100) return "unavailable";
  return "generic";
}

/** A normalized parent-observable provider signal (EARS-18.2). */
export type PlayerSignal =
  | { readonly kind: "playing" }
  | { readonly kind: "buffering" }
  | { readonly kind: "error"; readonly failure: PlayerFailureKind };

/** Coerce a postMessage payload (object, or a JSON string) to an object, or null. */
function asRecord(data: unknown): Record<string, unknown> | null {
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)
    : null;
}

/**
 * EARS-18.2 — parse a provider postMessage into a normalized {@link PlayerSignal},
 * or `null` when the message is unrelated/untrusted. The message is trusted ONLY
 * when it originates from the provider's own origin (a cross-origin embed's frame),
 * so a page-injected or foreign-origin message can never spoof a playing signal.
 *
 * - **youtube** — the IFrame Player API `infoDelivery`/`onStateChange` (playerState
 *   1 = playing, 3 = buffering) and `onError` (code → {@link mapYouTubeErrorCode}).
 * - **rutube** — the postMessage JSON API: `player:changeState` `state: "playing"`,
 *   and `player:error` (message only, no cause code → generic).
 * - **vk / cdnvideo** — no parent-observable API → always `null` (watchdog-only).
 */
export function parseProviderSignal(
  provider: StreamProvider,
  event: { origin: string; data: unknown },
): PlayerSignal | null {
  if (!PROVIDER_HAS_PARENT_API[provider]) return null;
  const expectedOrigin = PROVIDER_ORIGIN[provider];
  if (expectedOrigin && event.origin !== expectedOrigin) return null;

  const msg = asRecord(event.data);
  if (!msg) return null;

  if (provider === "youtube") {
    const kind = typeof msg.event === "string" ? msg.event : undefined;
    if (kind === "onError") {
      const code = typeof msg.info === "number" ? msg.info : Number(msg.info);
      return { kind: "error", failure: mapYouTubeErrorCode(code) };
    }
    // playerState arrives either as `info` (onStateChange) or `info.playerState`
    // (infoDelivery); 1 = playing, 3 = buffering.
    const info = msg.info;
    const state =
      typeof info === "number"
        ? info
        : typeof info === "object" && info !== null
          ? (info as Record<string, unknown>).playerState
          : undefined;
    if (state === 1) return { kind: "playing" };
    if (state === 3) return { kind: "buffering" };
    return null;
  }

  if (provider === "rutube") {
    const type = typeof msg.type === "string" ? msg.type : undefined;
    if (type === "player:error") return { kind: "error", failure: "generic" };
    if (type === "player:changeState") {
      const data = asRecord(msg.data);
      const state = data && typeof data.state === "string" ? data.state : undefined;
      if (state === "playing") return { kind: "playing" };
      if (state === "buffering" || state === "loading") return { kind: "buffering" };
    }
    return null;
  }

  return null;
}

/** The reducer state for the player-failure machine. */
export interface PlayerState {
  readonly status: PlayerStatus;
  readonly failure: PlayerFailureKind | null;
  /** Auto-retry attempts already spent (0…{@link PLAYER_MAX_AUTO_RETRIES}). */
  readonly attempt: number;
  /** Bumped to force a fresh iframe mount (re-create the embed) on each (re)load. */
  readonly embedKey: number;
}

export const INITIAL_PLAYER_STATE: PlayerState = {
  status: "loading",
  failure: null,
  attempt: 0,
  embedKey: 0,
};

/**
 * The player-failure state-machine actions:
 * - `playing` — a provider playing signal (EARS-18.4 recovery / first play).
 * - `fail` — the watchdog elapsed or a provider error (EARS-18.1 / 18.2).
 * - `retry` — the bounded auto-retry timer fired (EARS-18.3): re-create the embed.
 * - `restart` — the manual «Перезапустить плеер» affordance (EARS-18.3).
 */
export type PlayerAction =
  | { type: "playing" }
  | { type: "fail"; failure: PlayerFailureKind }
  | { type: "retry" }
  | { type: "restart" };

/**
 * EARS-18 state machine. A `fail` from `loading`/`playing` enters bounded auto-retry
 * (`retrying`) while attempts remain, else the terminal `failed` (manual restart
 * offered); a duplicate `fail` while already `failed`/`retrying` is ignored so a
 * burst of provider errors cannot exhaust the budget in one tick. `retry` re-creates
 * the embed (bumps `embedKey`) back to `loading`; `restart` resets the budget and
 * re-creates the embed; `playing` clears everything (EARS-18.4).
 */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "playing":
      return { ...state, status: "playing", failure: null };
    case "fail": {
      if (state.status === "failed" || state.status === "retrying") return state;
      if (state.attempt < PLAYER_MAX_AUTO_RETRIES) {
        return {
          ...state,
          status: "retrying",
          failure: action.failure,
          attempt: state.attempt + 1,
        };
      }
      return { ...state, status: "failed", failure: action.failure };
    }
    case "retry":
      if (state.status !== "retrying") return state;
      return { ...state, status: "loading", embedKey: state.embedKey + 1 };
    case "restart":
      return {
        status: "loading",
        failure: null,
        attempt: 0,
        embedKey: state.embedKey + 1,
      };
    default:
      return state;
  }
}

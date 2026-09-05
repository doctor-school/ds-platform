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
 *
 * **Two failure GRADES** keep the state truthful (design §3.1):
 * - **CONFIRMED** — an observed provider error event (youtube `onError`, rutube
 *   `player:error`), OR a watchdog stall AFTER a handshake was established (a real
 *   signal loss). The room covers the embed with a specific truthful status,
 *   auto-retries a bounded number of times, then offers the manual restart.
 * - **SUSPECTED** — a watchdog stall with NO positive signal ever observed (cdnvideo
 *   always, since it is structurally silent; youtube/rutube/vk when no handshake ever
 *   arrived). The room can NOT prove the stream failed — a healthy video may simply be
 *   unobservable — so it renders a NON-COVERING advisory banner beside the
 *   still-visible, still-interactive embed and does NOT auto-retry (an auto re-create
 *   would interrupt a possibly-healthy stream). Restart is manual only. For the
 *   permanently-unobservable cdnvideo the advisory is additionally TIME-BOXED
 *   ({@link PLAYER_ADVISORY_TIMEBOX_MS}) into the `unverified` state, so a
 *   healthy-but-silent stream is not nagged indefinitely (EARS-18.3).
 */

/**
 * Watchdog threshold (EARS-18.1) — the wall-clock budget from an embed mount to the
 * first observed playing signal. Elapsing with no signal raises a truthful status:
 * SUSPECTED grade when no handshake was ever seen, CONFIRMED grade when it was.
 * Named design constant (design §3.1, default ~20 s); the detection floor that works
 * even for providers that expose nothing to the parent.
 */
export const PLAYER_WATCHDOG_MS = 20_000;

/**
 * Bounded auto-retry budget (EARS-18.3) — a CONFIRMED failure re-creates the embed up
 * to this many times before surfacing the manual «Перезапустить плеер» affordance. A
 * SUSPECTED failure never auto-retries (manual only).
 */
export const PLAYER_MAX_AUTO_RETRIES = 2;

/** Delay between bounded auto-retry attempts (EARS-18.3). */
export const PLAYER_RETRY_DELAY_MS = 4_000;

/**
 * Advisory time box (EARS-18.3) — how long a SUSPECTED advisory banner may stand for
 * a PERMANENTLY-unobservable provider (cdnvideo) before it withdraws itself into the
 * `unverified` state, leaving only the gesture-gated «Перезапустить плеер». A silent
 * provider means an indefinitely-shown advisory would sit over a stream that is most
 * likely playing fine. Named design constant (design §3.1, default ~60 s — a
 * lead-chosen starting default, tunable after the first live cdnvideo эфир). The time
 * box is cdnvideo-ONLY: every other SUSPECTED case (a failed youtube/rutube/vk
 * handshake) keeps its banner, because for those a real signal can still arrive and a
 * self-withdrawing banner would hide an observable failure.
 */
export const PLAYER_ADVISORY_TIMEBOX_MS = 60_000;

/**
 * The runtime player state (design §3.1 state machine). `loading` covers the mount
 * window before the first playing signal (the provider renders its own spinner);
 * `retrying`/`failed` carry a {@link PlayerGrade} that decides covering-overlay
 * (confirmed) vs non-covering-banner (suspected); `unverified` is the post-time-box
 * SUSPECTED state (banner withdrawn, embed untouched, gesture-gated restart only);
 * `playing` clears everything.
 */
export type PlayerStatus =
  | "loading"
  | "playing"
  | "failed"
  | "retrying"
  | "unverified";

/**
 * The failure grade (design §3.1). `confirmed` = an observed provider error or a
 * post-handshake stall (the room may cover the embed + auto-retry); `suspected` = a
 * watchdog stall with no positive signal ever seen (advisory banner, manual only —
 * the room never covers an embed it cannot prove has failed).
 */
export type PlayerGrade = "confirmed" | "suspected";

/**
 * The failure classification that drives the CONFIRMED overlay copy (EARS-18.2).
 * `generic` covers a post-handshake watchdog stall and any provider error without a
 * distinguishing code (rutube `player:error` carries a message only; YouTube 153
 * referer). YouTube alone distinguishes:
 * - `embedding-disabled` — codes 101 / 150 (broadcaster disabled embedding).
 * - `unavailable` — code 100 (video unavailable).
 */
export type PlayerFailureKind = "embedding-disabled" | "unavailable" | "generic";

/**
 * Which providers expose a parent-observable API for the LIVE embed (design §3.1
 * table). `youtube` (IFrame Player API) and `rutube` (postMessage JSON API) do.
 * `vk` does TOO — conditionally: a VK live embed emits parent `postMessage` traffic
 * only when its src carries `js_api=1`, which {@link resolveEmbed} now always builds
 * (#1314; a live probe 2026-08-20 recorded `inited` ~t+4.5 s, `started` on play and a
 * recurring `timeupdate`). `cdnvideo` does NOT and never will: its served bundles emit
 * NO parent-directed message of any kind and render errors inside the iframe only — a
 * structural capability constraint verified by probe, so cdnvideo is watchdog-only and
 * can therefore only ever reach the SUSPECTED grade.
 */
export const PROVIDER_HAS_PARENT_API: Record<StreamProvider, boolean> = {
  youtube: true,
  rutube: true,
  vk: true,
  cdnvideo: false,
};

/** The origin each provider's embed posts messages from (postMessage source guard). */
const PROVIDER_ORIGIN: Partial<Record<StreamProvider, string>> = {
  youtube: "https://www.youtube.com",
  rutube: "https://rutube.ru",
  vk: "https://vk.com",
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

/**
 * A normalized parent-observable provider signal (EARS-18.2). `ready`/`buffering`
 * establish the handshake (a real API is talking) without yet meaning "playing";
 * `playing` clears the watchdog and presents the stream; `error` is a CONFIRMED
 * failure.
 */
export type PlayerSignal =
  | { readonly kind: "playing" }
  | { readonly kind: "ready" }
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
 * - **youtube** — the IFrame Player API `onReady` (ready), `infoDelivery`/
 *   `onStateChange` (playerState 1 = playing, 3 = buffering), `onError`
 *   (code → {@link mapYouTubeErrorCode}).
 * - **rutube** — the postMessage JSON API: `player:ready` (ready),
 *   `player:changeState` `state: "playing"`, and `player:error` (generic).
 * - **vk** — the VK Video player JS API (only with `js_api=1` in the src, #1314):
 *   `inited` (ready — the handshake), `started` (playing), and the recurring
 *   `timeupdate` whose top-level `state` is `"playing"` (playing) or `"unstarted"`
 *   (handshake only, not playing). VK exposes NO error event — a stall shows as an
 *   absent/non-advancing `timeupdate` and is graded by the watchdog — so this branch
 *   never synthesizes one.
 * - **cdnvideo** — no parent-observable API → always `null` (watchdog-only).
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
    if (kind === "onReady") return { kind: "ready" };
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
    if (type === "player:ready") return { kind: "ready" };
    if (type === "player:changeState") {
      const data = asRecord(msg.data);
      const state = data && typeof data.state === "string" ? data.state : undefined;
      if (state === "playing") return { kind: "playing" };
      if (state === "buffering" || state === "loading") return { kind: "buffering" };
    }
    return null;
  }

  if (provider === "vk") {
    // The event name key: VK's own docs (dev.vk.com «VK Video player JS API») were
    // unreachable from the build environment, and the 2026-08-20 probe recorded the
    // event NAMES (`inited` / `started` / `timeupdate`) without pinning the key, so
    // both documented spellings are accepted. This widens nothing dangerous — the
    // strict https://vk.com origin guard above is what makes a signal trustworthy,
    // and an unknown name still falls through to `null`.
    const name =
      typeof msg.event === "string"
        ? msg.event
        : typeof msg.type === "string"
          ? msg.type
          : undefined;
    if (name === "inited") return { kind: "ready" };
    if (name === "started") return { kind: "playing" };
    if (name === "timeupdate") {
      const state = typeof msg.state === "string" ? msg.state : undefined;
      if (state === "playing") return { kind: "playing" };
      // `unstarted` proves only that the API is talking — the handshake, not play.
      if (state === "unstarted") return { kind: "buffering" };
    }
    // No VK error event exists: never synthesize a CONFIRMED failure for vk.
    return null;
  }

  return null;
}

/** The reducer state for the player-failure machine. */
export interface PlayerState {
  readonly status: PlayerStatus;
  readonly grade: PlayerGrade | null;
  readonly failure: PlayerFailureKind | null;
  /** Auto-retry attempts already spent (0…{@link PLAYER_MAX_AUTO_RETRIES}). */
  readonly attempt: number;
  /** Bumped to force a fresh iframe mount (re-create the embed) on each (re)load. */
  readonly embedKey: number;
  /**
   * Whether a positive provider signal (playing / ready / buffering) has EVER been
   * observed for this stream. Monotonic (a real stream never becomes unobservable);
   * decides the grade of a watchdog stall — CONFIRMED if a handshake was seen,
   * SUSPECTED if never (vk/cdnvideo always; a youtube/rutube failed handshake).
   */
  readonly everReady: boolean;
}

export const INITIAL_PLAYER_STATE: PlayerState = {
  status: "loading",
  grade: null,
  failure: null,
  attempt: 0,
  embedKey: 0,
  everReady: false,
};

/**
 * The player-failure state-machine actions:
 * - `playing` — a provider playing signal (EARS-18.4 recovery / first play).
 * - `handshake` — a provider ready/buffering signal: the API is talking (EARS-18.2).
 * - `watchdog` — the watchdog elapsed with no playing signal (EARS-18.1).
 * - `error` — an observed provider error → always CONFIRMED (EARS-18.2).
 * - `retry` — the bounded auto-retry timer fired (EARS-18.3): re-create the embed.
 * - `timebox` — the advisory time box elapsed (EARS-18.3, cdnvideo only): withdraw
 *   the SUSPECTED banner into `unverified`, leaving the gesture-gated restart.
 * - `restart` — the manual «Перезапустить плеер» affordance (EARS-18.3).
 */
export type PlayerAction =
  | { type: "playing" }
  | { type: "handshake" }
  | { type: "watchdog" }
  | { type: "error"; failure: PlayerFailureKind }
  | { type: "retry" }
  | { type: "timebox" }
  | { type: "restart" };

/** Enter a CONFIRMED failure: auto-retry while the bounded budget remains, else the
 *  terminal `failed` (manual restart offered). */
function enterConfirmedFailure(
  state: PlayerState,
  failure: PlayerFailureKind,
): PlayerState {
  if (state.attempt < PLAYER_MAX_AUTO_RETRIES) {
    return {
      ...state,
      status: "retrying",
      grade: "confirmed",
      failure,
      attempt: state.attempt + 1,
    };
  }
  return { ...state, status: "failed", grade: "confirmed", failure };
}

/**
 * EARS-18 state machine. A `watchdog` stall grades by `everReady`: SUSPECTED (no
 * handshake ever — advisory banner, no auto-retry) or CONFIRMED (post-handshake
 * stall — covering overlay + bounded auto-retry). An `error` is always CONFIRMED. A
 * duplicate `watchdog`/`error` while already `failed`/`retrying` is ignored so a
 * burst cannot exhaust the budget in one tick. `retry` re-creates the embed (bumps
 * `embedKey`); `timebox` withdraws a standing SUSPECTED advisory into `unverified`
 * without touching the embed (EARS-18.3); `restart` resets the budget + re-creates the
 * embed (keeping the monotonic `everReady`); `playing` clears everything (EARS-18.4).
 */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case "playing":
      return { ...state, status: "playing", grade: null, failure: null, everReady: true };
    case "handshake":
      return state.everReady ? state : { ...state, everReady: true };
    case "watchdog": {
      if (state.status !== "loading") return state;
      if (!state.everReady) {
        // SUSPECTED — unprovable failure: advisory only, never cover the embed,
        // never auto-retry (a re-create would interrupt a possibly-healthy stream).
        return { ...state, status: "failed", grade: "suspected", failure: "generic" };
      }
      return enterConfirmedFailure(state, "generic");
    }
    case "error":
      if (state.status === "failed" || state.status === "retrying") return state;
      return enterConfirmedFailure(state, action.failure);
    case "retry":
      if (state.status !== "retrying") return state;
      return { ...state, status: "loading", embedKey: state.embedKey + 1 };
    case "timebox":
      // EARS-18.3 — only a standing SUSPECTED advisory is time-boxed; a CONFIRMED
      // overlay and every healthy status are untouched. The embed is NOT re-created
      // (that needs an explicit doctor gesture) and the grade stays `suspected`, so
      // the room never claims to have learned something it did not observe.
      if (state.status !== "failed" || state.grade !== "suspected") return state;
      return { ...state, status: "unverified" };
    case "restart":
      return {
        status: "loading",
        grade: null,
        failure: null,
        attempt: 0,
        embedKey: state.embedKey + 1,
        everReady: state.everReady,
      };
    default:
      return state;
  }
}

import { describe, expect, it } from "vitest";
import {
  INITIAL_PLAYER_STATE,
  PLAYER_MAX_AUTO_RETRIES,
  PROVIDER_HAS_PARENT_API,
  mapYouTubeErrorCode,
  parseProviderSignal,
  playerReducer,
  type PlayerState,
} from "./room-player-state";

// 006 EARS-18 — the in-room player-failure state machine (watchdog + provider-event
// layering + bounded in-room retry), TWO-GRADE model: CONFIRMED (an observed error,
// or a stall AFTER a handshake — covering overlay + auto-retry) vs SUSPECTED (a
// watchdog stall with NO signal ever — advisory banner, manual only, embed never
// covered/re-created). These lock the PURE logic; the fake-clock timer wiring + the
// visible overlay/banner are covered at the component tier (room-view.test.tsx), and
// the live room is driven by Playwright.
describe("006 EARS-18 player-failure state machine — pure logic", () => {
  // EARS-18.2 — YouTube alone distinguishes embedding-disabled (101/150) from
  // video-unavailable (100); every other code degrades to the generic status.
  it("EARS-18.2: maps YouTube 101/150 to embedding-disabled and 100 to unavailable", () => {
    expect(mapYouTubeErrorCode(101)).toBe("embedding-disabled");
    expect(mapYouTubeErrorCode(150)).toBe("embedding-disabled");
    expect(mapYouTubeErrorCode(100)).toBe("unavailable");
    expect(mapYouTubeErrorCode(153)).toBe("generic");
    expect(mapYouTubeErrorCode(2)).toBe("generic");
  });

  // EARS-18.2 — vk (live) and cdnvideo expose no parent-observable API: they are
  // watchdog-only, so they can only ever reach the SUSPECTED grade.
  it("EARS-18.2: vk and cdnvideo are watchdog-only (no parent-observable API)", () => {
    expect(PROVIDER_HAS_PARENT_API.youtube).toBe(true);
    expect(PROVIDER_HAS_PARENT_API.rutube).toBe(true);
    expect(PROVIDER_HAS_PARENT_API.vk).toBe(false);
    expect(PROVIDER_HAS_PARENT_API.cdnvideo).toBe(false);
    // No provider-event path is even parsed for a watchdog-only provider.
    expect(
      parseProviderSignal("vk", {
        origin: "https://vk.com",
        data: { type: "player:changeState", data: { state: "playing" } },
      }),
    ).toBeNull();
    expect(
      parseProviderSignal("cdnvideo", { origin: "https://playercdn.cdnvideo.ru", data: {} }),
    ).toBeNull();
  });

  // EARS-18.2 — the YouTube IFrame Player API ready / playing / error signals.
  it("EARS-18.2: parses YouTube ready, playing and error signals from the provider origin", () => {
    const yt = "https://www.youtube.com";
    expect(
      parseProviderSignal("youtube", { origin: yt, data: '{"event":"onReady"}' }),
    ).toEqual({ kind: "ready" });
    expect(
      parseProviderSignal("youtube", { origin: yt, data: '{"event":"onStateChange","info":1}' }),
    ).toEqual({ kind: "playing" });
    expect(
      parseProviderSignal("youtube", {
        origin: yt,
        data: '{"event":"infoDelivery","info":{"playerState":1}}',
      }),
    ).toEqual({ kind: "playing" });
    expect(
      parseProviderSignal("youtube", { origin: yt, data: '{"event":"onError","info":101}' }),
    ).toEqual({ kind: "error", failure: "embedding-disabled" });
    expect(
      parseProviderSignal("youtube", { origin: yt, data: '{"event":"onError","info":100}' }),
    ).toEqual({ kind: "error", failure: "unavailable" });
  });

  // EARS-18.2 — the Rutube postMessage JSON API ready / playing / error signals.
  it("EARS-18.2: parses Rutube ready, playing and a generic error from the provider origin", () => {
    const ru = "https://rutube.ru";
    expect(parseProviderSignal("rutube", { origin: ru, data: { type: "player:ready" } })).toEqual({
      kind: "ready",
    });
    expect(
      parseProviderSignal("rutube", {
        origin: ru,
        data: { type: "player:changeState", data: { state: "playing" } },
      }),
    ).toEqual({ kind: "playing" });
    expect(
      parseProviderSignal("rutube", { origin: ru, data: { type: "player:error", data: {} } }),
    ).toEqual({ kind: "error", failure: "generic" });
  });

  // EARS-18.2 — a message from a foreign / spoofed origin is never trusted as a
  // playing signal (the cross-origin embed guard).
  it("EARS-18.2: rejects a provider signal from a foreign origin", () => {
    expect(
      parseProviderSignal("youtube", {
        origin: "https://evil.example",
        data: '{"event":"onStateChange","info":1}',
      }),
    ).toBeNull();
    expect(
      parseProviderSignal("rutube", {
        origin: "https://evil.example",
        data: { type: "player:changeState", data: { state: "playing" } },
      }),
    ).toBeNull();
  });

  // EARS-18.1 — a watchdog stall with NO handshake ever observed is SUSPECTED: the
  // room can't prove failure, so it never auto-retries and never covers the embed.
  it("EARS-18.1: a watchdog stall with no handshake is SUSPECTED (no auto-retry)", () => {
    const next = playerReducer(INITIAL_PLAYER_STATE, { type: "watchdog" });
    expect(next.status).toBe("failed");
    expect(next.grade).toBe("suspected");
    expect(next.attempt).toBe(0); // never auto-retries
    expect(next.embedKey).toBe(0); // embed never re-created
  });

  // EARS-18.2 — a watchdog stall AFTER a handshake was established is CONFIRMED (a
  // real signal loss): it enters the bounded auto-retry.
  it("EARS-18.2: a watchdog stall after a handshake is CONFIRMED (enters auto-retry)", () => {
    const readied = playerReducer(INITIAL_PLAYER_STATE, { type: "handshake" });
    expect(readied.everReady).toBe(true);
    const next = playerReducer(readied, { type: "watchdog" });
    expect(next.status).toBe("retrying");
    expect(next.grade).toBe("confirmed");
    expect(next.attempt).toBe(1);
  });

  // EARS-18.2 — an observed provider ERROR is always CONFIRMED, even with no prior
  // handshake (an explicit error event is authoritative).
  it("EARS-18.2: an observed provider error is CONFIRMED even without a handshake", () => {
    const next = playerReducer(INITIAL_PLAYER_STATE, { type: "error", failure: "unavailable" });
    expect(next.status).toBe("retrying");
    expect(next.grade).toBe("confirmed");
    expect(next.failure).toBe("unavailable");
  });

  // EARS-18.3 — the CONFIRMED retry budget is bounded: after PLAYER_MAX_AUTO_RETRIES
  // the machine surfaces the terminal `failed` state (the manual restart affordance).
  it("EARS-18.3: exhausts the bounded auto-retry budget then surfaces the manual failed state", () => {
    let state: PlayerState = playerReducer(INITIAL_PLAYER_STATE, { type: "handshake" });
    for (let i = 0; i < PLAYER_MAX_AUTO_RETRIES; i += 1) {
      state = playerReducer(state, { type: "watchdog" });
      expect(state.status).toBe("retrying");
      expect(state.grade).toBe("confirmed");
      state = playerReducer(state, { type: "retry" });
      expect(state.status).toBe("loading");
    }
    // Budget spent — the next stall is terminal (manual «Перезапустить плеер»).
    state = playerReducer(state, { type: "watchdog" });
    expect(state.status).toBe("failed");
    expect(state.grade).toBe("confirmed");
    expect(state.attempt).toBe(PLAYER_MAX_AUTO_RETRIES);
  });

  // EARS-18.3 — each retry / restart re-creates the embed (a fresh iframe mount),
  // never a page reload; the embedKey monotonically bumps; restart keeps everReady.
  it("EARS-18.3: retry and restart re-create the embed by bumping the mount key", () => {
    const failed = {
      status: "failed",
      grade: "confirmed",
      failure: "generic",
      attempt: 2,
      embedKey: 5,
      everReady: true,
    } as PlayerState;
    const restarted = playerReducer(failed, { type: "restart" });
    expect(restarted.status).toBe("loading");
    expect(restarted.attempt).toBe(0);
    expect(restarted.grade).toBeNull();
    expect(restarted.failure).toBeNull();
    expect(restarted.embedKey).toBe(6);
    expect(restarted.everReady).toBe(true); // monotonic — the stream is known real
  });

  // EARS-18.3 — a burst of errors while already failing cannot exhaust the budget in
  // one tick (idempotent fail while failed/retrying).
  it("EARS-18.3: ignores a duplicate failure while already retrying", () => {
    const readied = playerReducer(INITIAL_PLAYER_STATE, { type: "handshake" });
    const retrying = playerReducer(readied, { type: "watchdog" });
    const again = playerReducer(retrying, { type: "error", failure: "unavailable" });
    expect(again).toBe(retrying);
  });

  // EARS-18.4 — a playing signal observed after a failure (suspected OR confirmed)
  // clears the overlay/banner and presents the stream (recovery / provider self-heal).
  it("EARS-18.4: a playing signal after a failure clears the failure and presents the stream", () => {
    const suspected = playerReducer(INITIAL_PLAYER_STATE, { type: "watchdog" });
    expect(suspected.grade).toBe("suspected");
    const recovered = playerReducer(suspected, { type: "playing" });
    expect(recovered.status).toBe("playing");
    expect(recovered.grade).toBeNull();
    expect(recovered.failure).toBeNull();
    expect(recovered.everReady).toBe(true);
  });
});

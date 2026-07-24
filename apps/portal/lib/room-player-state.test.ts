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
// layering + bounded in-room retry). These lock the PURE logic (error-code mapping,
// provider-signal parsing, the reducer transitions); the fake-clock timer wiring +
// the visible overlay/restart affordance are covered at the component tier
// (room-view.test.tsx), and the visible failure state is driven live by Playwright.
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
  // watchdog-only, a stated provider capability constraint.
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

  // EARS-18.2 — the YouTube IFrame Player API playing / error signals.
  it("EARS-18.2: parses a YouTube playing state and error code from the provider origin", () => {
    const yt = "https://www.youtube.com";
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

  // EARS-18.2 — the Rutube postMessage JSON API playing / error signals.
  it("EARS-18.2: parses a Rutube playing state and a generic error from the provider origin", () => {
    const ru = "https://rutube.ru";
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

  // EARS-18.1 — a fail transitions loading → retrying (auto-retry available); the
  // watchdog floor supplies the generic failure.
  it("EARS-18.1: a failure from loading enters bounded auto-retry, not the terminal state", () => {
    const next = playerReducer(INITIAL_PLAYER_STATE, { type: "fail", failure: "generic" });
    expect(next.status).toBe("retrying");
    expect(next.attempt).toBe(1);
    expect(next.failure).toBe("generic");
  });

  // EARS-18.3 — the retry budget is bounded: after PLAYER_MAX_AUTO_RETRIES the
  // machine surfaces the terminal `failed` state (the manual restart affordance).
  it("EARS-18.3: exhausts the bounded auto-retry budget then surfaces the manual failed state", () => {
    let state: PlayerState = INITIAL_PLAYER_STATE;
    for (let i = 0; i < PLAYER_MAX_AUTO_RETRIES; i += 1) {
      state = playerReducer(state, { type: "fail", failure: "generic" });
      expect(state.status).toBe("retrying");
      state = playerReducer(state, { type: "retry" });
      expect(state.status).toBe("loading");
    }
    // Budget spent — the next failure is terminal (manual «Перезапустить плеер»).
    state = playerReducer(state, { type: "fail", failure: "generic" });
    expect(state.status).toBe("failed");
    expect(state.attempt).toBe(PLAYER_MAX_AUTO_RETRIES);
  });

  // EARS-18.3 — each retry / restart re-creates the embed (a fresh iframe mount),
  // never a page reload; the embedKey monotonically bumps.
  it("EARS-18.3: retry and restart re-create the embed by bumping the mount key", () => {
    const failed = { status: "failed", failure: "generic", attempt: 2, embedKey: 5 } as PlayerState;
    const restarted = playerReducer(failed, { type: "restart" });
    expect(restarted.status).toBe("loading");
    expect(restarted.attempt).toBe(0);
    expect(restarted.failure).toBeNull();
    expect(restarted.embedKey).toBe(6);
  });

  // EARS-18.3 — a burst of provider errors while already failing cannot exhaust the
  // budget in one tick (idempotent fail while failed/retrying).
  it("EARS-18.3: ignores a duplicate failure while already retrying", () => {
    const retrying = playerReducer(INITIAL_PLAYER_STATE, { type: "fail", failure: "generic" });
    const again = playerReducer(retrying, { type: "fail", failure: "unavailable" });
    expect(again).toBe(retrying);
  });

  // EARS-18.4 — a playing signal observed after a failure clears the overlay and
  // presents the stream (recovery from auto-retry, manual restart, or provider self-heal).
  it("EARS-18.4: a playing signal after a failure clears the failure and presents the stream", () => {
    const retrying = playerReducer(INITIAL_PLAYER_STATE, { type: "fail", failure: "generic" });
    const recovered = playerReducer(retrying, { type: "playing" });
    expect(recovered.status).toBe("playing");
    expect(recovered.failure).toBeNull();
  });
});

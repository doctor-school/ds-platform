import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { usePlayerFailureState } from "./use-player-failure-state";
import { PLAYER_WATCHDOG_MS } from "../model/room-player-state";

/**
 * 006 EARS-18 — the hook half of the player-failure machine. The reducer itself is
 * proven in `../model/room-player-state.test.ts`; what only a rendered hook can
 * prove is the WIRING: that the watchdog is actually armed on mount, that a
 * provider `message` event reaches the reducer through the origin guard, and that
 * the two failure GRADES really do come out differently — a stall with no handshake
 * ever observed must stay SUSPECTED (advisory only; the room never covers a stream
 * it cannot prove has failed), while an observed provider error is CONFIRMED. The
 * hook moved into `@ds/room` carrying no test of its own; this is it.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function postFromYouTube(data: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", { origin: "https://www.youtube.com", data }),
  );
}

describe("006 EARS-18 usePlayerFailureState — watchdog, grades and restart", () => {
  it("006 EARS-18: a player failure transitions loading → playing → failed and offers restart", () => {
    const { result } = renderHook(() => usePlayerFailureState("youtube"));
    expect(result.current.status).toBe("loading");

    // A provider playing signal clears the watchdog (EARS-18.4).
    act(() => postFromYouTube({ event: "onStateChange", info: 1 }));
    expect(result.current.status).toBe("playing");

    // An observed provider error is CONFIRMED; the bounded auto-retry budget is
    // spent first, then the terminal state offers the manual restart (EARS-18.3).
    act(() => postFromYouTube({ event: "onError", info: 100 }));
    expect(result.current.status).toBe("retrying");
    act(() => {
      vi.runOnlyPendingTimers();
    });
    act(() => postFromYouTube({ event: "onError", info: 100 }));
    act(() => {
      vi.runOnlyPendingTimers();
    });
    act(() => postFromYouTube({ event: "onError", info: 100 }));
    expect(result.current.status).toBe("failed");
    expect(result.current.grade).toBe("confirmed");
    expect(result.current.failure).toBe("unavailable");

    const keyBeforeRestart = result.current.embedKey;
    act(() => result.current.restart());
    expect(result.current.status).toBe("loading");
    expect(result.current.grade).toBeNull();
    expect(result.current.embedKey).toBe(keyBeforeRestart + 1);
  });

  it("006 EARS-18: a suspected-failure timeout is distinguished from a hard failure", () => {
    // vk exposes no parent-observable API — a stall can NEVER be proven, so it must
    // grade SUSPECTED (advisory banner beside a still-interactive embed, no
    // auto-retry: re-creating it would interrupt a possibly-healthy stream).
    const vk = renderHook(() => usePlayerFailureState("vk"));
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS);
    });
    expect(vk.result.current.status).toBe("failed");
    expect(vk.result.current.grade).toBe("suspected");
    // No auto-retry was armed: the embed key never moved.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(vk.result.current.embedKey).toBe(0);

    // The same stall AFTER a handshake is a real signal loss → CONFIRMED, and the
    // bounded auto-retry re-creates the embed.
    const yt = renderHook(() => usePlayerFailureState("youtube"));
    act(() => postFromYouTube({ event: "onReady" }));
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS);
    });
    expect(yt.result.current.status).toBe("retrying");
    expect(yt.result.current.grade).toBe("confirmed");
  });
});

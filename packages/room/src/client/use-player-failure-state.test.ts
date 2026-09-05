import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { usePlayerFailureState } from "./use-player-failure-state";
import {
  PLAYER_ADVISORY_TIMEBOX_MS,
  PLAYER_WATCHDOG_MS,
} from "../model/room-player-state";

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

/** A VK JS API message as the `js_api=1` embed posts it (probe 2026-08-20). */
function postFromVk(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { origin: "https://vk.com", data }));
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
    // A vk embed whose `inited` handshake never arrives is a FAILED handshake — the
    // room cannot prove the stream died, so it must grade SUSPECTED (advisory banner
    // beside a still-interactive embed, no auto-retry: re-creating it would interrupt
    // a possibly-healthy stream). It is NOT time-boxed — that is cdnvideo-only.
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

  // EARS-18.2 / EARS-18.4 — the #1314 regression. A VK live embed built with
  // `js_api=1` DOES talk to the parent (`inited`, `started`, a recurring
  // `timeupdate` carrying `state: "playing"`). Before this handler existed the room
  // registered no vk listener, so a perfectly healthy VK stream tripped the watchdog
  // and showed «Похоже, трансляция не загружается» + «Перезапустить плеер» OVER
  // playing video. Observing the traffic must keep the room in `playing` — through
  // and well past the watchdog window.
  it("EARS-18.2: a vk timeupdate playing signal keeps the room playing past the watchdog (no false advisory)", () => {
    const { result } = renderHook(() => usePlayerFailureState("vk"));
    expect(result.current.status).toBe("loading");

    act(() =>
      postFromVk({ event: "inited" }),
    ); // handshake at ~t+4.5 s
    act(() => postFromVk({ event: "started" }));
    expect(result.current.status).toBe("playing");

    // The recurring timeupdate keeps arriving; the watchdog window elapses with the
    // stream visibly playing — no failure state, no restart affordance may appear.
    act(() => postFromVk({ event: "timeupdate", state: "playing", time: 4.2 }));
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS * 2);
    });
    expect(result.current.status).toBe("playing");
    expect(result.current.grade).toBeNull();
    expect(result.current.embedKey).toBe(0);
  });

  // EARS-18.3 — the cdnvideo advisory time box. cdnvideo is permanently silent, so an
  // indefinitely-shown advisory would nag over a stream that is most likely fine:
  // after PLAYER_ADVISORY_TIMEBOX_MS the banner is withdrawn (`unverified`), the
  // grade stays SUSPECTED and the embed is NEVER re-created on the timer.
  it("EARS-18.3: a cdnvideo suspected advisory times out to unverified without re-creating the embed", () => {
    const { result } = renderHook(() => usePlayerFailureState("cdnvideo"));
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS);
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.grade).toBe("suspected");

    act(() => {
      vi.advanceTimersByTime(PLAYER_ADVISORY_TIMEBOX_MS);
    });
    expect(result.current.status).toBe("unverified");
    expect(result.current.grade).toBe("suspected");
    expect(result.current.embedKey).toBe(0); // gesture-gated: never a timer re-create

    // The persistent restart control is the only exit, and it re-creates the embed.
    act(() => result.current.restart());
    expect(result.current.status).toBe("loading");
    expect(result.current.embedKey).toBe(1);
  });

  // EARS-18.3 — the time box is cdnvideo-ONLY: for a provider that genuinely can
  // still emit a signal (a failed youtube handshake) a self-withdrawing banner would
  // hide a real, observable failure, so the advisory persists.
  it("EARS-18.3: a youtube failed handshake advisory is NOT time-boxed", () => {
    const { result } = renderHook(() => usePlayerFailureState("youtube"));
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS);
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.grade).toBe("suspected");
    act(() => {
      vi.advanceTimersByTime(PLAYER_ADVISORY_TIMEBOX_MS * 2);
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.grade).toBe("suspected");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RoomCopy } from "./room-view";
import { PlayerFrame } from "./room-view";
import type { RoomConfig, StreamProvider } from "@ds/schemas";
import { PresenceHeartbeat } from "./presence-heartbeat";
import { RoomPresenceProvider } from "./room-presence";
import {
  PLAYER_RETRY_DELAY_MS,
  PLAYER_WATCHDOG_MS,
} from "../../../../lib/room-player-state";

/**
 * 006 EARS-18 — the in-room player-failure overlay + bounded retry, at the component
 * tier on a fake clock (design §12). The pure state machine is covered in
 * lib/room-player-state.test.ts; the visible overlay in the live room is driven by
 * Playwright (run in the live-verify wave). These lock: the watchdog raises a
 * truthful overlay (18.1), YouTube error codes map to distinct copy (18.2),
 * vk/cdnvideo are watchdog-only (18.2), the bounded auto-retry surfaces the manual
 * «Перезапустить плеер» with NO off-platform link and NO page reload (18.3), a
 * playing signal clears the overlay (18.4), and presence is decoupled (18.5).
 */
const copy = {
  liveBadge: "В эфире",
  onAir: "Идёт эфир",
  chatTab: "Чат",
  infoTab: "О эфире",
  chatHeading: "Чат эфира",
  chatCollapse: "Свернуть",
  chatExpand: "Развернуть",
  chatUnavailable: "Чат недоступен",
  unavailableTitle: "Трансляция недоступна",
  unavailableBody: "Восстанавливаем сигнал",
  playerTitle: "Трансляция эфира",
  playerRefresh: "Обновить страницу",
  playerFailedTitle: "Трансляция не загружается",
  playerFailedBody: "Перезапустите плеер",
  playerEmbeddingDisabled: "Встраивание отключено владельцем трансляции",
  playerUnavailable: "Видео недоступно",
  playerRetrying: "Переподключаемся к трансляции…",
  playerRestart: "Перезапустить плеер",
  programNow: "Эфир идёт",
} satisfies RoomCopy;

function configFor(provider: StreamProvider, embedRef = "abc123"): RoomConfig {
  return { stream: { provider, embedRef } } as unknown as RoomConfig;
}

function renderPlayer(provider: StreamProvider) {
  return render(<PlayerFrame config={configFor(provider)} copy={copy} />);
}

/** Advance fake timers by `ms` inside act (drives watchdog / retry timeouts). */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Fire a provider postMessage as if from the embed's own origin. */
function fireProviderMessage(origin: string, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { origin, data }));
  });
}

describe("006 EARS-18 player-failure overlay + bounded retry (component)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // EARS-18.1 — no playing signal within the watchdog → a truthful in-frame status
  // overlay, never a silent black frame. (vk is watchdog-only, the pure floor.)
  it("EARS-18.1: raises a truthful status overlay when no playing signal arrives within the watchdog", () => {
    renderPlayer("vk");
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-vk")).toBeInTheDocument();
    advance(PLAYER_WATCHDOG_MS);
    const overlay = screen.getByTestId("room-player-failure");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveTextContent("Трансляция не загружается");
    // still a live embed underneath (never a black frame) — the iframe stays mounted.
    expect(screen.getByTestId("room-player-vk")).toBeInTheDocument();
  });

  // EARS-18.2 — a YouTube onError distinguishes embedding-disabled (101/150) from
  // video-unavailable (100) in the status copy.
  it("EARS-18.2: a YouTube 101 error shows the embedding-disabled status", () => {
    renderPlayer("youtube");
    fireProviderMessage("https://www.youtube.com", '{"event":"onError","info":101}');
    expect(screen.getByTestId("room-player-failure")).toHaveTextContent(
      "Встраивание отключено владельцем трансляции",
    );
  });

  it("EARS-18.2: a YouTube 100 error shows the video-unavailable status", () => {
    renderPlayer("youtube");
    fireProviderMessage("https://www.youtube.com", '{"event":"onError","info":100}');
    expect(screen.getByTestId("room-player-failure")).toHaveTextContent("Видео недоступно");
  });

  // EARS-18.2 — cdnvideo exposes no parent-observable API: it is watchdog-only, so a
  // provider-shaped message never clears or changes the state; only the watchdog does.
  it("EARS-18.2: cdnvideo is watchdog-only — a provider message never drives it", () => {
    renderPlayer("cdnvideo");
    // a playing-shaped message from any origin is ignored (no parent API for cdnvideo)
    fireProviderMessage("https://playercdn.cdnvideo.ru", {
      type: "player:changeState",
      data: { state: "playing" },
    });
    advance(PLAYER_WATCHDOG_MS);
    // the watchdog still fired the overlay — the message did NOT count as a playing signal
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
  });

  // EARS-18.4 — a playing signal observed after a failure clears the overlay and
  // presents the stream (rutube self-recovery via its postMessage API).
  it("EARS-18.4: a rutube playing signal after a failure clears the overlay", () => {
    renderPlayer("rutube");
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
    fireProviderMessage("https://rutube.ru", {
      type: "player:changeState",
      data: { state: "playing" },
    });
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-rutube")).toBeInTheDocument();
  });

  // EARS-18.3 — on failure the room auto-retries a bounded number of times, then
  // offers a manual «Перезапустить плеер» that re-creates the embed in-room —
  // NEVER a page reload and NEVER an off-platform link.
  it("EARS-18.3: exhausts the bounded auto-retry then offers an in-room restart, no reload, no off-platform link", () => {
    const { container } = renderPlayer("vk");
    // walk the bounded budget: (watchdog → retry) × PLAYER_MAX_AUTO_RETRIES, then a
    // final watchdog with the budget spent → the terminal manual-restart state.
    advance(PLAYER_WATCHDOG_MS); // attempt 1 → retrying (auto)
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
    advance(PLAYER_RETRY_DELAY_MS); // re-create embed → loading
    advance(PLAYER_WATCHDOG_MS); // attempt 2 → retrying (auto)
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
    advance(PLAYER_RETRY_DELAY_MS); // re-create embed → loading
    advance(PLAYER_WATCHDOG_MS); // budget spent → failed (manual)

    const restart = screen.getByTestId("room-player-restart");
    expect(restart).toHaveTextContent("Перезапустить плеер");
    // never a "watch on the provider's site" / off-platform link in the room
    expect(container.querySelector("a")).toBeNull();

    // activating restart re-creates the embed in-room (overlay clears), no page reload
    act(() => {
      fireEvent.click(restart);
    });
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-vk")).toBeInTheDocument();
  });
});

/**
 * EARS-18.5 — the player failure/retry/unavailable state does NOT affect presence
 * capture: the visibility-gated heartbeat loop (EARS-4) is decoupled from player
 * state. Here the real {@link PresenceHeartbeat} runs alongside a failing player;
 * the beat POST keeps firing on its cadence across the player's failure.
 */
describe("006 EARS-18.5 presence is decoupled from player state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flushBeat() {
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
  }

  it("EARS-18.5: the heartbeat keeps firing while the player is in the failure state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          eventId: "e1",
          beatAt: new Date().toISOString(),
          presenceCount: 1,
        }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RoomPresenceProvider initialCount={1}>
        <PresenceHeartbeat slug="hsn" intervalSeconds={5} />
        <PlayerFrame config={configFor("vk")} copy={copy} />
      </RoomPresenceProvider>,
    );

    // three beats before any player failure (the player is still Loading)
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      await flushBeat();
    }
    const beatsBeforeFailure = fetchMock.mock.calls.length;
    expect(beatsBeforeFailure).toBeGreaterThanOrEqual(3);

    // drive the player into the failure state (watchdog elapses)
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS);
    });
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();

    // beats keep firing across the failure — presence is unaffected
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      await flushBeat();
    }
    expect(fetchMock.mock.calls.length).toBeGreaterThan(beatsBeforeFailure);
  });
});

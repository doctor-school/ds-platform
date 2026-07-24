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
 * 006 EARS-18 — the in-room player-failure states at the component tier on a fake
 * clock (design §12), TWO-GRADE model. The pure state machine is covered in
 * lib/room-player-state.test.ts; the visible overlay/banner in the live room is
 * driven by Playwright (live-verify wave). These lock:
 *  - 18.1 a watchdog stall with no signal raises a NON-COVERING advisory banner
 *    (SUSPECTED) over a still-visible embed, and NEVER auto-retries / re-creates it;
 *  - 18.2 an observed YouTube error is CONFIRMED (covering overlay, distinct copy),
 *    a no-handshake stall is SUSPECTED, a post-handshake stall is CONFIRMED,
 *    vk/cdnvideo are watchdog-only (SUSPECTED);
 *  - 18.3 a CONFIRMED failure auto-retries then offers the manual «Перезапустить
 *    плеер» — NO off-platform link, NO page reload;
 *  - 18.4 a playing signal clears the overlay/banner;
 *  - 18.5 presence is decoupled from player state.
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
  playerSuspectedBody: "Похоже, трансляция не загружается. Если видео не идёт — перезапустите плеер.",
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

describe("006 EARS-18 player-failure two-grade model (component)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // EARS-18.1 — a watchdog stall with NO observable signal (vk, watchdog-only) is
  // SUSPECTED: a NON-COVERING advisory banner beside a still-visible embed, never a
  // covering "confirmed failure" overlay over possibly-healthy video.
  it("EARS-18.1: a watchdog stall on a watchdog-only provider raises a non-covering advisory banner", () => {
    renderPlayer("vk");
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    advance(PLAYER_WATCHDOG_MS);
    const banner = screen.getByTestId("room-player-suspected");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Похоже, трансляция не загружается");
    // NON-covering: the container does not intercept pointer events over the embed.
    expect(banner.className).toContain("pointer-events-none");
    // it is NOT the covering confirmed overlay, and the embed stays visible.
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-vk")).toBeInTheDocument();
  });

  // EARS-18.1 — a SUSPECTED stall NEVER auto-retries: no covering overlay ever
  // appears and the manual restart affordance is offered from the start (manual only).
  it("EARS-18.1: a suspected stall never auto-retries (manual restart only)", () => {
    renderPlayer("vk");
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-restart")).toBeInTheDocument();
    // walk well past several retry+watchdog windows — the state must not escalate to
    // a covering retry/failed overlay (an auto re-create would interrupt healthy video).
    advance(PLAYER_RETRY_DELAY_MS + PLAYER_WATCHDOG_MS * 2);
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-suspected")).toBeInTheDocument();
  });

  // EARS-18.2 — an observed YouTube error is a CONFIRMED failure (covering overlay)
  // and distinguishes embedding-disabled (101/150) from video-unavailable (100).
  it("EARS-18.2: a YouTube 101 error is a confirmed failure with the embedding-disabled status", () => {
    renderPlayer("youtube");
    fireProviderMessage("https://www.youtube.com", '{"event":"onError","info":101}');
    expect(screen.getByTestId("room-player-failure")).toHaveTextContent(
      "Встраивание отключено владельцем трансляции",
    );
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
  });

  it("EARS-18.2: a YouTube 100 error is a confirmed failure with the video-unavailable status", () => {
    renderPlayer("youtube");
    fireProviderMessage("https://www.youtube.com", '{"event":"onError","info":100}');
    expect(screen.getByTestId("room-player-failure")).toHaveTextContent("Видео недоступно");
  });

  // EARS-18.2 — a YouTube stall with NO handshake ever (script/handshake failed) is
  // SUSPECTED, not confirmed: the room never covers a possibly-healthy embed.
  it("EARS-18.2: a YouTube stall with no handshake is SUSPECTED (non-covering banner)", () => {
    renderPlayer("youtube");
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-suspected")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
  });

  // EARS-18.2 — once the handshake IS established, a later watchdog stall counts as a
  // CONFIRMED failure (real signal loss) → covering overlay + auto-retry.
  it("EARS-18.2: a YouTube stall AFTER a handshake is CONFIRMED (covering overlay)", () => {
    renderPlayer("youtube");
    fireProviderMessage("https://www.youtube.com", '{"event":"onReady"}');
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
  });

  // EARS-18.2 — cdnvideo is watchdog-only: a provider-shaped message never counts as
  // a signal, and the stall raises the SUSPECTED advisory banner.
  it("EARS-18.2: cdnvideo is watchdog-only — a provider message is ignored, stall is suspected", () => {
    renderPlayer("cdnvideo");
    fireProviderMessage("https://playercdn.cdnvideo.ru", {
      type: "player:changeState",
      data: { state: "playing" },
    });
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-suspected")).toBeInTheDocument();
  });

  // EARS-18.4 — a playing signal observed after a CONFIRMED failure clears the overlay
  // and presents the stream (rutube self-recovery via its postMessage API).
  it("EARS-18.4: a rutube playing signal after a confirmed failure clears the overlay", () => {
    renderPlayer("rutube");
    fireProviderMessage("https://rutube.ru", { type: "player:ready" }); // handshake
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
    fireProviderMessage("https://rutube.ru", {
      type: "player:changeState",
      data: { state: "playing" },
    });
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-rutube")).toBeInTheDocument();
  });

  // EARS-18.3 — a CONFIRMED failure auto-retries a bounded number of times, then
  // offers a manual in-room restart that re-creates the embed — NEVER a page reload
  // and NEVER an off-platform link.
  it("EARS-18.3: a confirmed failure exhausts auto-retry then offers an in-room restart, no reload/off-platform link", () => {
    const { container } = renderPlayer("youtube");
    fireProviderMessage("https://www.youtube.com", '{"event":"onReady"}'); // handshake → confirmed grade
    advance(PLAYER_WATCHDOG_MS); // attempt 1 → retrying (auto, covering overlay, no restart yet)
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
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
    expect(screen.getByTestId("room-player-youtube")).toBeInTheDocument();
  });
});

/**
 * EARS-18.5 — the player failure/retry/suspected state does NOT affect presence
 * capture: the visibility-gated heartbeat loop (EARS-4) is decoupled from player
 * state. Here the real {@link PresenceHeartbeat} runs alongside a failing player; the
 * beat POST keeps firing on its cadence across the player's failure.
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

    // drive the player into the (suspected) failure state (watchdog elapses)
    act(() => {
      vi.advanceTimersByTime(PLAYER_WATCHDOG_MS);
    });
    expect(screen.getByTestId("room-player-suspected")).toBeInTheDocument();

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

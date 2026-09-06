import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PlayerFrame } from "./room-view";
import type { RoomConfig, StreamProvider } from "@ds/schemas";
import { createBrowserRoomApi } from "../client/room-api";
import {
  PLAYER_RETRY_DELAY_MS,
  PLAYER_WATCHDOG_MS,
} from "../model/room-player-state";
import { PresenceHeartbeat } from "./presence-heartbeat";
import { RoomPresenceProvider } from "./room-presence";

/**
 * 006 EARS-18 — the in-room player-failure states at the component tier on a fake
 * clock (design §12), TWO-GRADE model. The pure state machine is covered in
 * packages/room/src/model/room-player-state.test.ts; the visible overlay/banner in the live room is
 * driven by Playwright (live-verify wave). These lock:
 *  - 18.1 a watchdog stall with no signal raises a NON-COVERING advisory banner
 *    (SUSPECTED) over a still-visible embed, and NEVER auto-retries / re-creates it;
 *  - 18.2 an observed YouTube error is CONFIRMED (covering overlay, distinct copy),
 *    a no-handshake stall is SUSPECTED, a post-handshake stall is CONFIRMED,
 *    a failed handshake on an observable provider is SUSPECTED, while the
 *    structurally silent cdnvideo is never graded at all (`unverified` from mount);
 *  - 18.3 a CONFIRMED failure auto-retries then offers the manual «Перезапустить
 *    плеер» — NO off-platform link, NO page reload;
 *  - 18.4 a playing signal clears the overlay/banner;
 *  - 18.5 presence is decoupled from player state.
 */
const copy = {
  liveBadge: "В эфире",
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
  endedTitle: "Эфир завершён",
  endedBody: "Запись появится в разделе «Мои события»",
};

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

  // EARS-18.1 — a watchdog stall with NO handshake ever observed on an OBSERVABLE
  // provider (a rutube embed whose `player:ready` never arrived) is SUSPECTED: a
  // NON-COVERING advisory banner beside a still-visible embed, never a covering
  // "confirmed failure" overlay over possibly-healthy video.
  it("EARS-18.1: a watchdog stall with no handshake raises a non-covering advisory banner", () => {
    renderPlayer("rutube");
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    advance(PLAYER_WATCHDOG_MS);
    const banner = screen.getByTestId("room-player-suspected");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Похоже, трансляция не загружается");
    // NON-covering: the container does not intercept pointer events over the embed.
    expect(banner.className).toContain("pointer-events-none");
    // it is NOT the covering confirmed overlay, and the embed stays visible.
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.getByTestId("room-player-rutube")).toBeInTheDocument();
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

  // EARS-18.2 — cdnvideo exposes no parent API: a provider-shaped message from its
  // origin never counts as a signal, and the room states nothing either way — it
  // stays `unverified`, with no advisory banner and no covering overlay.
  it("EARS-18.2: a cdnvideo provider-shaped message is ignored and raises no failure state", () => {
    renderPlayer("cdnvideo");
    fireProviderMessage("https://playercdn.cdnvideo.ru", {
      type: "player:changeState",
      data: { state: "playing" },
    });
    advance(PLAYER_WATCHDOG_MS * 3);
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
    expect(screen.getByTestId("room-player-cdnvideo")).toBeInTheDocument();
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

  // EARS-18.2 / EARS-18.4 — the #1314 false positive at the component tier. A VK
  // embed built with `js_api=1` posts `inited` / `started` / `timeupdate` to the
  // parent; while that traffic is observed the room must show NO advisory and NO
  // «Перезапустить плеер» — previously the room registered no vk listener, so the
  // watchdog fired over visibly playing video.
  it("EARS-18.2: an observed vk playing signal leaves no advisory or restart over playing video", () => {
    renderPlayer("vk");
    fireProviderMessage("https://vk.com", { event: "inited" });
    fireProviderMessage("https://vk.com", {
      event: "timeupdate",
      state: "playing",
      time: 3.1,
    });
    advance(PLAYER_WATCHDOG_MS * 2);
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
    expect(screen.getByTestId("room-player-vk")).toBeInTheDocument();
  });

  // EARS-18.3 — cdnvideo mounts in `unverified` and the room renders NOTHING of its
  // own over the embed: no advisory, no covering overlay and no room-owned control —
  // a bare provider iframe whose own in-iframe controls are the only affordance. A
  // permanently visible room-owned button is the same intrusion as a permanently
  // visible banner (owner decision 2026-09-06), and the room has no evidence that
  // would justify either.
  it("EARS-18.3: cdnvideo mounts unverified — the room renders nothing of its own", () => {
    const { container } = renderPlayer("cdnvideo");
    const embed = screen.getByTestId("room-player-cdnvideo");
    const src = embed.getAttribute("src");
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
    // No room-owned control of any kind sits over the embed (the live badge is a
    // pre-existing, non-interactive label, not a player affordance).
    expect(container.querySelector("button")).toBeNull();

    // No wall-clock passage may raise a room-owned element or re-create the embed.
    advance(PLAYER_WATCHDOG_MS * 5);
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    // The very same iframe node, same src — never re-created behind the doctor.
    expect(screen.getByTestId("room-player-cdnvideo")).toBe(embed);
    expect(embed).toHaveAttribute("src", src as string);
  });

  // EARS-18.1 — an OBSERVABLE provider is untouched: a failed youtube handshake keeps
  // its advisory banner — a real, observable failure must not self-hide.
  it("EARS-18.1: a youtube suspected advisory persists", () => {
    renderPlayer("youtube");
    advance(PLAYER_WATCHDOG_MS);
    expect(screen.getByTestId("room-player-suspected")).toBeInTheDocument();
    advance(PLAYER_WATCHDOG_MS * 5);
    expect(screen.getByTestId("room-player-suspected")).toBeInTheDocument();
  });

  // EARS-2 × EARS-18.3 — the config-absent "stream unavailable" branch returns before
  // any player-failure UI, so neither an advisory nor a covering overlay can appear
  // there whatever the state machine holds.
  it("EARS-18.3: the EARS-2 unavailable branch never shows a player-failure state", () => {
    render(<PlayerFrame config={{ stream: null } as unknown as RoomConfig} copy={copy} />);
    advance(PLAYER_WATCHDOG_MS * 3);
    expect(screen.getByTestId("room-player-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
  });
});

/**
 * 006 EARS-7 (#1238) — an already-open room whose event has ENDED. The bug this
 * closes is a room that keeps presenting a finished broadcast as live: the player
 * region must stop being a player, and it must stop claiming «В эфире».
 *
 * The plate is the EXISTING covering player plate reused (owner 2026-09-05), and
 * it REPLACES the embed rather than covering it — an iframe left mounted keeps the
 * provider's stream and audio running behind the card (design §8.3).
 */
describe("006 EARS-7 the ended room's end card replaces the player", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("EARS-7.3: the ended player region states «Эфир завершён» and unmounts the embed", () => {
    render(<PlayerFrame config={configFor("youtube")} copy={copy} ended />);

    const card = screen.getByTestId("room-player-ended");
    expect(card).toBeInTheDocument();
    expect(card.textContent).toContain(copy.endedTitle);
    expect(card.textContent).toContain(copy.endedBody);
    // The stream is GONE, not hidden: no iframe survives the transition.
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByTestId("room-player-youtube")).toBeNull();
  });

  it("EARS-7.3: the ended region carries no live badge and no control", () => {
    render(<PlayerFrame config={configFor("youtube")} copy={copy} ended />);

    expect(screen.queryByText(copy.liveBadge)).toBeNull();
    // No restart, no refresh — the recording is not ready at close, so the room
    // offers nothing it cannot deliver.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByTestId("room-player-restart")).toBeNull();
  });

  it("EARS-7.3: no player-failure state can surface over the end card", () => {
    render(<PlayerFrame config={configFor("vk")} copy={copy} ended />);
    advance(PLAYER_WATCHDOG_MS + PLAYER_RETRY_DELAY_MS + PLAYER_ADVISORY_TIMEBOX_MS);

    expect(screen.getByTestId("room-player-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByTestId("room-player-suspected")).toBeNull();
    expect(screen.queryByTestId("room-player-unverified-restart")).toBeNull();
  });

  it("EARS-7.3: an ended room with no stream config shows the end card, not «Трансляция недоступна»", () => {
    render(
      <PlayerFrame
        config={{ stream: null } as unknown as RoomConfig}
        copy={copy}
        ended
      />,
    );

    expect(screen.getByTestId("room-player-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-unavailable")).toBeNull();
  });

  it("EARS-7.3: a room that has NOT ended is untouched — the embed and the live badge stay", () => {
    render(<PlayerFrame config={configFor("youtube")} copy={copy} />);

    expect(screen.queryByTestId("room-player-ended")).toBeNull();
    expect(screen.getByTestId("room-player-youtube")).toBeInTheDocument();
    expect(screen.getByText(copy.liveBadge)).toBeInTheDocument();
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
        <PresenceHeartbeat
          api={createBrowserRoomApi({ slug: "hsn" })}
          intervalSeconds={5}
        />
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

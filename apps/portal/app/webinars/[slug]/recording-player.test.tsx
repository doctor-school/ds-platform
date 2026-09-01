import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RecordingPlayer,
  RECORDING_PLAYER_LOAD_TIMEOUT_MS,
  type RecordingPlayerProps,
} from "./recording-player";

/**
 * 014 EARS-7 — the player failure boundary. Every assertion here is one form of
 * the same promise: a doctor is never left in front of a frame that silently
 * gives them nothing. jsdom fires no real provider events, which is exactly the
 * point — the events are driven explicitly, and the QUIET failure (no event at
 * all) is driven by the clock.
 */
const COPY = {
  unavailableTitle: "Запись временно недоступна",
  unavailableBody:
    "Плеер не загрузился. Проверьте соединение и попробуйте ещё раз.",
  retryLabel: "Попробовать ещё раз",
};

function renderPlayer(over: Partial<RecordingPlayerProps> = {}) {
  return render(
    <RecordingPlayer
      provider="rutube"
      embedRef="0123456789abcdef0123456789abcdef"
      title="Пластика ахиллова сухожилия"
      kindLabel="Монтаж"
      {...COPY}
      {...over}
    />,
  );
}

const frame = () => screen.queryByTestId("recording-player-rutube");
const message = () => screen.queryByTestId("recording-player-unavailable");

describe("014 EARS-7 — the recording player failure boundary", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("014 EARS-7.8: a healthy embed renders the provider frame and no failure message — the boundary is invisible while the player works", () => {
    renderPlayer();
    const iframe = frame();
    expect(iframe).not.toBeNull();
    expect(iframe).toHaveAttribute(
      "src",
      "https://rutube.ru/play/embed/0123456789abcdef0123456789abcdef",
    );
    // The accessible name names the recording, not «iframe».
    expect(iframe).toHaveAttribute(
      "title",
      "Пластика ахиллова сухожилия — Монтаж",
    );
    expect(message()).toBeNull();
  });

  it("014 EARS-7.9: the frame's own error event replaces the player with the explicit RU message — never a dead frame left on screen", () => {
    renderPlayer();
    fireEvent.error(frame()!);

    expect(frame()).toBeNull();
    expect(screen.getByText(COPY.unavailableTitle)).toBeVisible();
    expect(screen.getByText(COPY.unavailableBody)).toBeVisible();
  });

  it("014 EARS-7.10: an embed that delivers NOTHING fails on the watchdog — the endless spinner is the failure mode with no event of its own", () => {
    renderPlayer();
    expect(message()).toBeNull();

    act(() => void vi.advanceTimersByTime(RECORDING_PLAYER_LOAD_TIMEOUT_MS));

    expect(frame()).toBeNull();
    expect(screen.getByText(COPY.unavailableTitle)).toBeVisible();
  });

  it("014 EARS-7.11: a frame that loads cancels the watchdog — a working player is never torn down by a timer that outlived its reason", () => {
    renderPlayer();
    fireEvent.load(frame()!);

    act(() => void vi.advanceTimersByTime(RECORDING_PLAYER_LOAD_TIMEOUT_MS * 3));

    expect(frame()).not.toBeNull();
    expect(message()).toBeNull();
  });

  it("014 EARS-7.12: retry re-creates the frame — a genuinely fresh mount, not the same dead document shown again", () => {
    renderPlayer();
    const firstKey = frame();
    fireEvent.error(firstKey!);

    fireEvent.click(screen.getByTestId("recording-player-retry"));

    const retried = frame();
    expect(retried).not.toBeNull();
    // A new element instance — the embed was re-requested, not un-hidden.
    expect(retried).not.toBe(firstKey);
    expect(message()).toBeNull();
  });

  it("014 EARS-7.13: retry re-arms the watchdog — a second silent failure is caught exactly like the first, so retrying can never lead into a permanent spinner", () => {
    renderPlayer();
    act(() => void vi.advanceTimersByTime(RECORDING_PLAYER_LOAD_TIMEOUT_MS));
    fireEvent.click(screen.getByTestId("recording-player-retry"));
    expect(frame()).not.toBeNull();

    act(() => void vi.advanceTimersByTime(RECORDING_PLAYER_LOAD_TIMEOUT_MS));

    expect(frame()).toBeNull();
    expect(screen.getByText(COPY.unavailableTitle)).toBeVisible();
  });

  it("014 EARS-7.14: a source that cannot be composed is the SAME honest failure, reached before any frame is mounted — never a blank card", () => {
    // A malformed vk ref: the resolver composes no src rather than guessing one.
    renderPlayer({ provider: "vk", embedRef: "not-a-vk-triple" });

    expect(screen.queryByTestId("recording-player-vk")).toBeNull();
    expect(screen.getByText(COPY.unavailableTitle)).toBeVisible();
    expect(screen.getByTestId("recording-player-retry")).toBeVisible();
  });
});

describe("014 EARS-5 — an authenticated read that carried no source", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("014 EARS-5.6: a signed-in doctor whose source read came back empty gets the same honest unavailability message, never a frame with nothing behind it", () => {
    renderPlayer({ provider: null, embedRef: null });
    expect(frame()).toBeNull();
    expect(message()).not.toBeNull();
    expect(screen.getByTestId("recording-player-retry")).not.toBeNull();
  });
});

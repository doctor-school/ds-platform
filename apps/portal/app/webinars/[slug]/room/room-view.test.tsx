// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoomConfig, StreamConfig } from "@ds/schemas";
import { RoomView } from "./room-view";
import type { RoomContext, RoomCopy } from "./room-view";

// #1125 — the room must NEVER present a silent black screen. A well-formed embed
// that the provider refuses (YouTube geo-blocked in RU, or «Allow embedding» off
// on the broadcast) renders a black iframe the app cannot detect cross-origin. So
// beneath the player an ALWAYS-PRESENT truthful direct-watch link opens the
// provider's own watch page — shown whenever there is a stream, absent only in the
// "stream unavailable" state (nothing to link to).

// Passthrough i18n: return the key so assertions target stable copy keys/testids.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// The chat pane is out of scope here — stub it so the Centrifuge SDK never loads.
vi.mock("./room-chat", () => ({ RoomChat: () => null }));

// jsdom has no matchMedia; WebinarRoomLayout reads it for its responsive split.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const COPY: RoomCopy = {
  liveBadge: "liveBadge",
  onAir: "onAir",
  chatTab: "chatTab",
  infoTab: "infoTab",
  chatUnavailable: "chatUnavailable",
  unavailableTitle: "unavailableTitle",
  unavailableBody: "unavailableBody",
  playerTitle: "playerTitle",
  programNow: "programNow",
  directLinkPrompt: "directLinkPrompt",
  directLinkCta: "directLinkCta",
};

const CONTEXT: RoomContext = {
  school: "school",
  title: "title",
  speakers: "speakers",
};

function config(stream: StreamConfig | null): RoomConfig {
  return {
    eventId: "00000000-0000-0000-0000-000000000000",
    heartbeatIntervalSeconds: 20,
    liveAt: "2026-07-18T10:00:00+00:00",
    presenceCount: 1,
    stream,
    chat: null,
  };
}

function renderRoom(stream: StreamConfig | null) {
  render(
    <RoomView slug="event-x" config={config(stream)} context={CONTEXT} copy={COPY} />,
  );
}

describe("#1125 RoomView — always-present truthful direct-watch link (no silent black screen)", () => {
  it("EARS-2.1: renders the YouTube direct-watch link beneath the player", () => {
    renderRoom({ provider: "youtube", embedRef: "NSVn97_5BXc" });
    const link = screen.getByRole("link", { name: "directLinkCta" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=NSVn97_5BXc",
    );
    // Opens the provider's own page safely in a new tab.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("room-player-youtube")).toBeTruthy();
  });

  it("EARS-2.1: renders the Rutube direct-watch link beneath the player", () => {
    renderRoom({ provider: "rutube", embedRef: "caafe83ff1c6ed38d394635b83ece578" });
    expect(
      screen.getByRole("link", { name: "directLinkCta" }),
    ).toHaveAttribute(
      "href",
      "https://rutube.ru/video/caafe83ff1c6ed38d394635b83ece578/",
    );
  });

  it("EARS-2.1: the 'stream unavailable' state shows no direct link (nothing to link to)", () => {
    renderRoom(null);
    expect(screen.getByTestId("room-player-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("room-player-direct-link")).toBeNull();
    expect(screen.queryByRole("link", { name: "directLinkCta" })).toBeNull();
  });
});

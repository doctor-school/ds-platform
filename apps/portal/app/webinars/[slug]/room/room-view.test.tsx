// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoomConfig } from "@ds/schemas";
import { PlayerFrame, type RoomCopy } from "./room-view";

// 006 EARS-2 / EARS-9 — the room composes an embed FRAME plus a truthful
// direct-link fallback to the provider's OWN watch page (#1134 AC: "portal
// renders the VK embed + direct link"). The link is a plain anchor (no proxy /
// re-host — EARS-9 boundary intact); it is the recovery affordance when the embed
// itself is refused broadcaster-side (the #1125 black-screen failure class). The
// "stream unavailable" state has nothing to link to, so it shows no direct link.

// Passthrough i18n — assert on stable testids / hrefs, not copy.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const copy: RoomCopy = {
  liveBadge: "В эфире",
  onAir: "Идёт эфир",
  chatTab: "",
  infoTab: "",
  chatHeading: "",
  chatCollapse: "",
  chatExpand: "",
  chatUnavailable: "",
  unavailableTitle: "Трансляция недоступна",
  unavailableBody: "…",
  playerTitle: "Трансляция",
  playerRefresh: "Обновить",
  programNow: "",
  openDirect: "Открыть у провайдера",
};

function config(stream: RoomConfig["stream"]): RoomConfig {
  return {
    eventId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    heartbeatIntervalSeconds: 60,
    liveAt: null,
    presenceCount: 0,
    stream,
    chat: null,
  };
}

describe("006 EARS-2 PlayerFrame — embed frame + direct-link fallback", () => {
  it("EARS-2: renders the VK embed AND a direct-link fallback to the provider watch page", () => {
    render(
      <PlayerFrame
        config={config({ provider: "vk", embedRef: "-9944999_456239622" })}
        copy={copy}
      />,
    );
    // The embed frame itself.
    expect(screen.getByTestId("room-player-vk")).toBeTruthy();
    // The direct-link fallback (#1134) — the provider's own watch page, new tab.
    const link = screen.getByTestId("room-player-direct");
    expect(link.getAttribute("href")).toBe("https://vk.com/video-9944999_456239622");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("EARS-2: the direct link points at each provider's own watch page", () => {
    render(
      <PlayerFrame
        config={config({
          provider: "rutube",
          embedRef: "caafe83ff1c6ed38d394635b83ece578",
        })}
        copy={copy}
      />,
    );
    expect(screen.getByTestId("room-player-direct").getAttribute("href")).toBe(
      "https://rutube.ru/video/caafe83ff1c6ed38d394635b83ece578/",
    );
  });

  it("EARS-2: the 'stream unavailable' state renders no direct link (nothing to link to)", () => {
    render(<PlayerFrame config={config(null)} copy={copy} />);
    expect(screen.getByTestId("room-player-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("room-player-direct")).toBeNull();
  });
});

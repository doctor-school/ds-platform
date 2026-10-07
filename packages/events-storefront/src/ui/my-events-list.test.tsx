import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyEventItem } from "@ds/schemas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { MyEventsList } from "./my-events-list";

/**
 * 004 EARS-12 as amended 2026-10-02 — «Мои события» is a viewer-zone surface
 * (wave-2 entry gate row 26). The server render and the first client render
 * agree on МСК, so hydration never mismatches and nothing shifts; after mount an
 * online row re-formats to the viewer zone, an offline row stays МСК.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function resolveZoneAs(timeZone: string) {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolved,
    timeZone,
  });
}

const row = (over: Partial<MyEventItem>): MyEventItem => ({
  eventId: "11111111-1111-4111-8111-111111111111",
  slug: "online-row",
  title: "Онлайн",
  school: "Школа",
  // 19:00 МСК, 23:00 in Novosibirsk (UTC+7).
  startsAt: "2026-07-16T16:00:00.000Z",
  state: "published",
  recording: null,
  participationFormat: "online",
  roomHref: null,
  ...over,
});

const PROPS = {
  events: [
    row({}),
    row({
      eventId: "22222222-2222-4222-8222-222222222222",
      slug: "offline-row",
      title: "Очно",
      participationFormat: "offline",
    }),
  ],
  tab: "upcoming" as const,
  counts: { upcoming: 2, recordings: 0 },
  routes: { eventPage: "/events", accountEvents: "/account/events" },
};

describe("004 EARS-12 «Мои события» times (gate row 26)", () => {
  it("004 EARS-12: the server render shows every row in МСК", () => {
    resolveZoneAs("Asia/Novosibirsk");
    const html = renderToString(createElement(MyEventsList, PROPS));
    expect(html).toContain("19:00");
    expect(html).not.toContain("23:00");
    expect(html).not.toContain("GMT+7");
  });

  it("004 EARS-12: an online row re-formats to the viewer zone after hydration; an offline row stays МСК", () => {
    resolveZoneAs("Asia/Novosibirsk");
    const { container } = render(createElement(MyEventsList, PROPS));
    // Both rows share the instant: 23:00 can only be the online row in the
    // viewer zone, 19:00 МСК only the offline row (the server render had no 23:00).
    expect(screen.getByText("Онлайн")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain("23:00");
    expect(text).toContain("GMT+7");
    expect(text).toContain("19:00");
    expect(text).toContain("МСК");
  });
});

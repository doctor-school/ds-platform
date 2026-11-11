// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import { EventGoneNotice } from "./event-gone-notice";
import { hasEventGoneNotice, withEventGoneNotice } from "./marker";

/**
 * 021 EARS-10 (amendment 2026-11-11, #2272) — the one-time notice on the
 * default landing a doctor reaches when the carried эфир no longer exists.
 */

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("021 EARS-10 event-gone landing notice", () => {
  it("021 EARS-10: the marker is one fixed parameter appended to the landing path", () => {
    expect(withEventGoneNotice("/")).toBe("/?notice=event-gone");
    expect(withEventGoneNotice("/feed/kardiologiya")).toBe(
      "/feed/kardiologiya?notice=event-gone",
    );
    expect(withEventGoneNotice("/webinars?ds_guest=1")).toBe(
      "/webinars?ds_guest=1&notice=event-gone",
    );
  });

  it("021 EARS-10: only the exact whitelisted value is the marker", () => {
    expect(hasEventGoneNotice({ notice: "event-gone" })).toBe(true);
    expect(hasEventGoneNotice({})).toBe(false);
    expect(hasEventGoneNotice({ notice: "something-else" })).toBe(false);
    expect(hasEventGoneNotice({ notice: ["event-gone", "event-gone"] })).toBe(
      false,
    );
  });

  it("021 EARS-10: the marker renders the info line on both storefronts' landings", () => {
    for (const [config, landing] of [
      [DOCTOR_AUTH_FLOW, "afterLogin"],
      [DOCTOR_AUTH_FLOW, "specialtyFeed"],
      [ACADEMY_AUTH_FLOW, "afterLogin"],
    ] as const) {
      render(
        <EventGoneNotice
          config={config}
          landing={landing}
          searchParams={{ notice: "event-gone" }}
        />,
      );
      const line = screen.getByTestId("event-gone-notice");
      expect(line.getAttribute("role")).toBe("status");
      expect(line.textContent).toContain("больше недоступен");
      cleanup();
    }
  });

  it("021 EARS-10: no marker, or any other value, renders nothing", () => {
    for (const searchParams of [
      {},
      { notice: "x" },
      { notice: "Эфир удалён" },
      { other: "event-gone" },
    ]) {
      const { container } = render(
        <EventGoneNotice
          config={DOCTOR_AUTH_FLOW}
          landing="afterLogin"
          searchParams={searchParams}
        />,
      );
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("021 EARS-10: after rendering, the marker leaves the address bar so a reload does not repeat it", () => {
    window.history.replaceState(
      null,
      "",
      "/feed/kardiologiya?notice=event-gone&keep=1#top",
    );
    render(
      <EventGoneNotice
        config={DOCTOR_AUTH_FLOW}
        landing="specialtyFeed"
        searchParams={{ notice: "event-gone", keep: "1" }}
      />,
    );
    expect(screen.getByTestId("event-gone-notice")).toBeTruthy();
    expect(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    ).toBe("/feed/kardiologiya?keep=1#top");
  });
});

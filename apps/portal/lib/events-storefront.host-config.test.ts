import { describe, expect, it } from "vitest";

import { ACADEMY_EVENT_PAGE } from "./events-storefront.host-config";

// Wave-3 gate §4.4 — the Academy's event-page host config is data only: the
// public read path, the routes `academy.doctor.school` serves and the one copy
// word the page varies by host. No relay cookie (the Academy read is public).
describe("020 EARS-18 ACADEMY_EVENT_PAGE — the Academy's event-page host values", () => {
  it("EARS-18: reads the public event page and states the Academy routes and breadcrumb", () => {
    expect(ACADEMY_EVENT_PAGE).toEqual({
      contentSet: { pagePath: "/v1/public/events" },
      routes: {
        listing: "/webinars",
        eventPage: "/webinars",
        login: "/login",
        register: "/register",
      },
      copy: { breadcrumb: "Эфиры" },
    });
  });

  it("EARS-18: carries no function-valued field (closed adapter list §4.5 is empty)", () => {
    const values = JSON.stringify(ACADEMY_EVENT_PAGE, (_k, v: unknown) =>
      typeof v === "function" ? "<fn>" : v,
    );
    expect(values).not.toContain("<fn>");
  });
});

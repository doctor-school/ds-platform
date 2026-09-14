import { describe, expect, it } from "vitest";

import { resolveRoute, routeParams } from "./route-params.js";

describe("resolveRoute", () => {
  it("substitutes the golden slug into a dynamic pattern", () => {
    expect(resolveRoute("academy", "/webinars/[slug]")).toBe(
      "/webinars/golden-event-upcoming",
    );
    expect(resolveRoute("doctor", "/events/[slug]")).toBe(
      "/events/golden-event-upcoming",
    );
  });

  it("uses the live golden event for the room route on both hosts", () => {
    expect(resolveRoute("academy", "/webinars/[slug]/room")).toBe(
      "/webinars/golden-event-live/room",
    );
    expect(resolveRoute("doctor", "/events/[slug]/room")).toBe(
      "/events/golden-event-live/room",
    );
  });

  it("returns undefined for a route no golden entity renders", () => {
    // §6.3: the walk turns this into a FAILING test naming the route. The golden
    // catalogue seeds no document row, so `/documents/[slug]` — the very route
    // #2012 broke — is the live example of the gap the contract makes visible.
    expect(resolveRoute("academy", "/documents/[slug]")).toBeUndefined();
    expect(resolveRoute("doctor", "/documents/[slug]")).toBeUndefined();
  });

  it("keys the map per host so one host's entry cannot satisfy the other", () => {
    expect(routeParams.academy["/events/[slug]"]).toBeUndefined();
    expect(routeParams.doctor["/webinars/[slug]"]).toBeUndefined();
  });
});

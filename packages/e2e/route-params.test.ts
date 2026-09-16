import { describe, expect, it } from "vitest";

import { listDocuments } from "@ds/legal-content";

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

  it("resolves /documents/[slug] from the legal-content catalogue the pages enumerate", () => {
    // The documents are FILES, not DB rows: both hosts' `generateStaticParams`
    // enumerate `listDocuments()`, so the walk must address the same catalogue.
    // The first slug in the catalogue's slug-sorted order is the deterministic
    // choice — same address on every run and on both hosts.
    const [first] = listDocuments();
    expect(first).toBeDefined();
    expect(resolveRoute("academy", "/documents/[slug]")).toBe(
      `/documents/${first!.slug}`,
    );
    expect(resolveRoute("doctor", "/documents/[slug]")).toBe(
      `/documents/${first!.slug}`,
    );
  });

  it("returns undefined for a route no entity renders", () => {
    // §6.3: the walk turns this into a FAILING test naming the route rather than
    // skipping it, so a new dynamic route cannot enter the build unanswered.
    expect(resolveRoute("academy", "/nothing/[slug]")).toBeUndefined();
    expect(resolveRoute("doctor", "/nothing/[slug]")).toBeUndefined();
  });

  it("keys the map per host so one host's entry cannot satisfy the other", () => {
    expect(routeParams.academy["/events/[slug]"]).toBeUndefined();
    expect(routeParams.doctor["/webinars/[slug]"]).toBeUndefined();
  });
});

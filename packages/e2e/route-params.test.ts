import { describe, expect, it } from "vitest";

import { listDocuments } from "@ds/legal-content";

import {
  UNKNOWN_ADDRESS_SEGMENT,
  directVisitAnswer,
  resolveRoute,
  routeParams,
} from "./route-params.js";

describe("resolveRoute", () => {
  it("substitutes the golden slug into a dynamic pattern", () => {
    expect(resolveRoute("academy", "/webinars/[slug]")).toBe(
      "/webinars/golden-event-upcoming",
    );
    expect(resolveRoute("doctor", "/events/[slug]")).toBe(
      "/events/golden-event-upcoming",
    );
  });

  it("uses each storefront's live golden event for its room route", () => {
    expect(resolveRoute("academy", "/webinars/[slug]/room")).toBe(
      "/webinars/golden-event-live-academy/room",
    );
    expect(resolveRoute("doctor", "/events/[slug]/room")).toBe(
      "/events/golden-event-live/room",
    );
  });

  it("resolves the Academy reading page to the golden published material", () => {
    // 048 EARS-11 — `/materials/[slug]` renders a published material row, so its
    // address comes from the golden seed like `/webinars/[slug]`. The doctor
    // host has no reading page (048 EARS-17), so it carries no entry.
    expect(resolveRoute("academy", "/materials/[slug]")).toBe(
      "/materials/golden-material-published",
    );
    expect(routeParams.doctor["/materials/[slug]"]).toBeUndefined();
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

  it("addresses the Academy catch-all with an unknown path that answers 404", () => {
    // #2478 — the catch-all exists to answer addresses no route serves, so the
    // walk opens one and asserts the not-found page's 404 instead of a 200.
    expect(resolveRoute("academy", "/[...catchAll]")).toBe(
      `/${UNKNOWN_ADDRESS_SEGMENT}`,
    );
    expect(directVisitAnswer("academy", "/[...catchAll]")).toEqual({
      status: 404,
      cite: "#2478",
    });
    expect(routeParams.doctor["/[...catchAll]"]).toBeUndefined();
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

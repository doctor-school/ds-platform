import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-72 — the storefront refusal page mount, read as an element: the
 * refusal comes only from the gate's hand-over; the variant from the
 * injectable random source; the way out from the entry's event.
 *
 * Mocked seams: the request headers and Next's `notFound` throw.
 */
const { requestHeaders, notFound } = vi.hoisted(() => ({
  requestHeaders: { value: new Headers() },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("next/navigation", () => ({ notFound }));

import { ENTRY_REFUSAL_COPY } from "../copy/entry-refusal";
import { ACADEMY_AUTH_FLOW, DOCTOR_AUTH_FLOW } from "../hosts";
import {
  ENTRY_REFUSAL_HEADER,
  writeEntryRefusal,
  type EntryRefusal as Refusal,
} from "../server/entry-refusal";
import type { EntryRefusalProps } from "./entry-refusal";
import {
  ENTRY_REFUSAL_PAGE_METADATA,
  pickRefusalVariant,
  StorefrontEntryRefusalRoute,
} from "./entry-refusal-route";

function handOver(value: Refusal | string | null) {
  const headers = new Headers();
  if (value !== null) {
    headers.set(
      ENTRY_REFUSAL_HEADER,
      typeof value === "string" ? value : writeEntryRefusal(value),
    );
  }
  requestHeaders.value = headers;
}

beforeEach(() => {
  notFound.mockClear();
});

describe("storefront refusal page", () => {
  it("003 EARS-72: each render picks one variant at random among the reason's three", () => {
    for (const reason of ["rate-limited", "unavailable"] as const) {
      expect(pickRefusalVariant(reason, () => 0)).toBe(0);
      expect(pickRefusalVariant(reason, () => 0.5)).toBe(1);
      expect(pickRefusalVariant(reason, () => 0.9999)).toBe(2);
    }
  });

  it("003 EARS-72: a hand-over renders the refusal with its wait and the picked variant; the way out is the home page", async () => {
    handOver({ reason: "rate-limited", retryAfterSeconds: 105 });
    const el = (await StorefrontEntryRefusalRoute({
      config: ACADEMY_AUTH_FLOW,
      homeHref: "/",
      random: () => 0.7,
    })) as ReactElement<EntryRefusalProps>;
    expect(el.props).toMatchObject({
      reason: "rate-limited",
      retryAfterSeconds: 105,
      variant: 2,
      wayOut: { kind: "link", href: "/", label: ENTRY_REFUSAL_COPY.home },
    });
  });

  it("003 EARS-72: an entry from an event page leads back to that event on this storefront's event path", async () => {
    for (const [config, path] of [
      [ACADEMY_AUTH_FLOW, "/webinars/live-1"],
      [DOCTOR_AUTH_FLOW, "/events/live-1"],
    ] as const) {
      handOver({
        reason: "unavailable",
        retryAfterSeconds: null,
        eventSlug: "live-1",
      });
      const el = (await StorefrontEntryRefusalRoute({
        config,
        homeHref: "/",
      })) as ReactElement<EntryRefusalProps>;
      expect(el.props.wayOut).toEqual({
        kind: "link",
        href: path,
        label: ENTRY_REFUSAL_COPY.backToEvent,
      });
    }
  });

  it("003 EARS-72: no hand-over or a malformed one is no page (not found)", async () => {
    for (const value of [null, "reason=bogus", "garbage"]) {
      handOver(value);
      await expect(
        StorefrontEntryRefusalRoute({
          config: ACADEMY_AUTH_FLOW,
          homeHref: "/",
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("003 EARS-72: the page's metadata is its tab title and is never indexed", () => {
    expect(ENTRY_REFUSAL_PAGE_METADATA).toEqual({
      title: ENTRY_REFUSAL_COPY.pageTitle,
      robots: { index: false, follow: false },
    });
  });
});

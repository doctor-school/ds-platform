import { describe, expect, it } from "vitest";

import type { DoctorConfirmResponse } from "@ds/schemas";

import { resolveConfirmLanding } from "./confirm-landing";

/**
 * 021 EARS-10 (amended 2026-09-17) — the landing, asserted where it is decided.
 *
 * The clause's substance is a choice between three href sources, and the one
 * failure that matters is silent: a confirmation that navigates a visitor
 * somewhere other than the point of interest they carried looks exactly like a
 * correct one. So the rule is pinned here, per branch, rather than only through
 * the browser.
 */
const SLUG = "prp-pri-gonartroze";
const FALLBACK = "/events?specialty=kardiologiya";

function response(
  primaryAction: DoctorConfirmResponse["primaryAction"],
): DoctorConfirmResponse {
  return {
    status: "verified",
    credited: null,
    profileCompletion: null,
    primaryAction,
    secondaryAction: { kind: "cabinet", href: "/account" },
  };
}

describe("resolveConfirmLanding", () => {
  it("021 EARS-10: a live carried target lands on the server's own reconstruction of it", () => {
    expect(
      resolveConfirmLanding(
        response({ kind: "return", href: `/events/${SLUG}` }),
        FALLBACK,
      ),
    ).toBe(`/events/${SLUG}`);
  });

  it("021 EARS-10: a stale carried target lands on the honest destination the server picked (LD-8)", () => {
    // The four reasons are the closed set the contract declares; each one means
    // the server knew WHY the target could not be honoured and chose the
    // nearest destination with that knowledge, which the client cannot improve.
    for (const reason of ["ended", "full", "unpublished", "missing"] as const) {
      expect(
        resolveConfirmLanding(
          response({ kind: "landing", href: `/events/${SLUG}`, reason }),
          FALLBACK,
        ),
      ).toBe(`/events/${SLUG}`);
    }
  });

  it("021 EARS-10: a cold arrival lands on the DOOR's LD-4 decision, not the API's default", () => {
    // No reason means nothing was carried, and the door's landing was taken
    // with 017's remembered specialty — the one fact the confirm route lacks.
    expect(
      resolveConfirmLanding(
        response({ kind: "landing", href: "/events" }),
        FALLBACK,
      ),
    ).toBe(FALLBACK);
  });
});

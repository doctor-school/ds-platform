import { describe, expect, it } from "vitest";

import type { DoctorConfirmResponse } from "@ds/schemas";

import {
  ACCRUAL_PROMISE,
  LANDING_REASON_COPY,
  resolveRegistrationSuccess,
} from "./registration-success";

/**
 * 021 EARS-10 (#1546) — the landing composition, asserted where it is decided.
 *
 * The clause's substance is a choice between three href sources, and the one
 * failure that matters is silent: a success state that sends a doctor somewhere
 * other than the point of interest they carried still renders perfectly. So the
 * rule is pinned here, per branch, rather than only through the browser.
 */
const SLUG = "prp-pri-gonartroze";
const FALLBACK = "/events?specialty=kardiologiya";

function response(
  primaryAction: DoctorConfirmResponse["primaryAction"],
  extra: Partial<DoctorConfirmResponse> = {},
): DoctorConfirmResponse {
  return {
    status: "verified",
    credited: null,
    profileCompletion: null,
    primaryAction,
    secondaryAction: { kind: "cabinet", href: "/account" },
    ...extra,
  };
}

describe("resolveRegistrationSuccess", () => {
  it("021 EARS-10: a live carried target lands on the server's own reconstruction of it", () => {
    const view = resolveRegistrationSuccess(
      response({ kind: "return", href: `/events/${SLUG}` }),
      FALLBACK,
    );

    expect(view.primary.href).toBe(`/events/${SLUG}`);
    expect(view.primary.label).toBe("Вернуться к эфиру →");
    expect(view.reason).toBeNull();
  });

  it("021 EARS-10: the cabinet is the secondary action, on the contract's own path", () => {
    const view = resolveRegistrationSuccess(
      response({ kind: "return", href: `/events/${SLUG}` }),
      FALLBACK,
    );

    expect(view.secondary).toEqual({
      href: "/account",
      label: "В личный кабинет",
    });
  });

  it("021 EARS-10: a direct arrival lands on the DOOR's landing, not the server's bare default", () => {
    // The server has no access to 017's remembered specialty; the door read it
    // from the cookie before the first byte of HTML. Its answer wins.
    const view = resolveRegistrationSuccess(
      response({ kind: "landing", href: "/events" }),
      FALLBACK,
    );

    expect(view.primary.href).toBe(FALLBACK);
    expect(view.primary.label).toBe("К ближайшим эфирам →");
    expect(view.reason).toBeNull();
  });

  it("021 EARS-10: a direct arrival with the storefront home as its landing is labelled by destination", () => {
    const view = resolveRegistrationSuccess(
      response({ kind: "landing", href: "/events" }),
      "/",
    );

    expect(view.primary).toEqual({ href: "/", label: "На главную →" });
  });

  it.each([
    ["ended", `/events/${SLUG}`, "Открыть страницу эфира →"],
    ["full", `/events/${SLUG}`, "Открыть страницу эфира →"],
    ["unpublished", "/events", "К ближайшим эфирам →"],
    ["missing", "/events", "К ближайшим эфирам →"],
  ] as const)(
    "021 EARS-10: a %s target keeps the SERVER's degraded landing and states what happened",
    (reason, href, label) => {
      const view = resolveRegistrationSuccess(
        response({ kind: "landing", href, reason }),
        FALLBACK,
      );

      // The degraded href is the server's, never the door's fallback: only the
      // server knows the эфир page is still readable.
      expect(view.primary).toEqual({ href, label });
      expect(view.reason).toBe(LANDING_REASON_COPY[reason]);
    },
  );

  it("021 EARS-9: with no credited fact the accrual is the pending promise, with no amount in it", () => {
    const view = resolveRegistrationSuccess(
      response({ kind: "landing", href: "/events" }),
      FALLBACK,
    );

    expect(view.accrual).toBe(ACCRUAL_PROMISE);
    expect(view.accrual).not.toMatch(/\d/);
  });

  it("021 EARS-9: a credited amount is stated as the fact it is", () => {
    const view = resolveRegistrationSuccess(
      response({ kind: "landing", href: "/events" }, { credited: 20 }),
      FALLBACK,
    );

    expect(view.accrual).toBe(
      "Вам начислено 20 Pul — стартовые очки за регистрацию.",
    );
  });

  it("021 EARS-9: the profile-completion line is passed through, absent stays absent", () => {
    expect(
      resolveRegistrationSuccess(
        response({ kind: "landing", href: "/events" }),
        FALLBACK,
      ).profileCompletion,
    ).toBeNull();

    expect(
      resolveRegistrationSuccess(
        response(
          { kind: "landing", href: "/events" },
          { profileCompletion: "Заполните профиль — ещё 30 Pul." },
        ),
        FALLBACK,
      ).profileCompletion,
    ).toBe("Заполните профиль — ещё 30 Pul.");
  });
});

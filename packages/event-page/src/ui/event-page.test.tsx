import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventPageHostConfig } from "../host-config";

// The page's READ half (wave-3 gate §2.1 rows 1, 4, 13): the event read and
// the participation read sit at the host's `contentSet.pagePath`, an unknown
// slug is not-found, and a guest never issues the authenticated playback read.
const reads = vi.hoisted(() => ({
  fetchPublicEventPage: vi.fn(),
  fetchParticipationCta: vi.fn(),
  fetchEventRegistrationState: vi.fn(),
  forwardedSessionFrom: vi.fn(() => ({
    cookie: "",
    userAgent: "UA",
    acceptLanguage: "ru",
    forwardedFor: "",
  })),
}));
const playback = vi.hoisted(() => ({ fetchEventPlayback: vi.fn() }));
const NOT_FOUND = new Error("NEXT_NOT_FOUND");

vi.mock("@ds/events-storefront/server", () => reads);
vi.mock("../server/event-playback", () => playback);
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));

const { EventPage } = await import("./event-page");

const CONFIG = {
  contentSet: { pagePath: "/v1/storefront/doctor/events" },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    register: "/register",
  },
  copy: { breadcrumb: "События" },
} satisfies EventPageHostConfig;

function mount(slug: string) {
  return EventPage({
    config: CONFIG,
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("020 EARS-1 EventPage — the reads sit at the host's pagePath", () => {
  it("EARS-1: an unknown or draft slug renders not-found and issues no further read", async () => {
    reads.fetchPublicEventPage.mockResolvedValue(null);

    await expect(mount("draft")).rejects.toBe(NOT_FOUND);
    expect(reads.fetchPublicEventPage).toHaveBeenCalledWith(
      "draft",
      "/v1/storefront/doctor/events",
    );
    expect(reads.fetchParticipationCta).not.toHaveBeenCalled();
  });

  it("EARS-1: the participation read is addressed at the host's pagePath; a guest never issues the playback read", async () => {
    reads.fetchParticipationCta.mockResolvedValue(null);
    reads.fetchEventRegistrationState.mockResolvedValue(null);
    // The full read-model render is exercised by the Academy e2e; here only
    // the addressing of the second read is pinned, so the event read answers
    // with a minimal body and the render past the reads is not asserted.
    reads.fetchPublicEventPage.mockResolvedValue({
      slug: "cardio-2026",
      state: "published",
      recording: { state: "none" },
    });
    await mount("cardio-2026").catch(() => undefined);
    expect(reads.fetchParticipationCta).toHaveBeenCalledWith(
      "cardio-2026",
      expect.objectContaining({ cookie: "" }),
      "/v1/storefront/doctor/events",
    );
    expect(playback.fetchEventPlayback).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseAcademyEventReturnTarget,
  parseDoctorEventReturnTarget,
} from "@ds/schemas";

// 005 EARS-2 — the RESUME side of the guest-through-auth completion: once the
// 003 session exists, the carried registration-intent fires the SAME
// `RegisterForEvent` (EARS-1) and the doctor lands back on the originally chosen
// event page registered — no re-search, no second «Участвовать» tap. A hostile
// (cross-origin / open-redirect) returnTo never completes anything and never
// becomes a navigation target (requirements Constraints; design §3.2).
//
// The register client is mocked: EARS-2 owns the carry + resume mechanics; the
// command server semantics are EARS-1/EARS-3 (already shipped).
//
// The rule is asserted through BOTH host projections, because that is the point
// of the shared unit: one decision rule, two ReturnHost configs.

const { registerForEvent } = vi.hoisted(() => ({
  registerForEvent: vi.fn(),
}));
vi.mock("./registration-client", () => ({ registerForEvent }));

import {
  completeReturnTarget,
  currentReturnTarget,
  type ReturnHost,
} from "./registration-resume";

/** The academy projection: /webinars/<slug> pages plus the /room return. */
const ACADEMY: ReturnHost = {
  parseRoomReturn: (raw) => {
    const inner =
      typeof raw === "string" && raw.endsWith("/room")
        ? parseAcademyEventReturnTarget(raw.slice(0, -5))
        : null;
    return inner ? { returnTo: `${inner.returnTo}/room` } : null;
  },
  parseIntent: parseAcademyEventReturnTarget,
  defaultLanding: "/webinars",
};

/** The doctor projection: /events/<slug> pages, no room-return of its own here. */
const DOCTOR: ReturnHost = {
  parseRoomReturn: () => null,
  parseIntent: parseDoctorEventReturnTarget,
  defaultLanding: "/events",
};

beforeEach(() => {
  registerForEvent.mockReset();
  registerForEvent.mockResolvedValue({
    registered: true,
    registeredAt: "2026-07-08T10:00:00+00:00",
  });
});

describe("005 EARS-2 guest-through-auth completion (registration resume)", () => {
  it("005 EARS-2: when auth succeeds with a carried event context, the system shall fire RegisterForEvent for that same event and land on that event page", async () => {
    const landing = await completeReturnTarget("/webinars/ahilles-042", ACADEMY);

    // The SAME EARS-1 command fires for the carried slug…
    expect(registerForEvent).toHaveBeenCalledTimes(1);
    expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
    // …and the doctor lands back on the originally chosen event page — no
    // re-search, no second «Участвовать» tap.
    expect(landing).toBe("/webinars/ahilles-042");
  });

  it("020 EARS-1: the SAME rule on the doctor storefront resumes an /events/<slug> intent and lands on that host event page", async () => {
    const landing = await completeReturnTarget("/events/ahilles-042", DOCTOR);

    expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
    expect(landing).toBe("/events/ahilles-042");
  });

  it("008 EARS-7: with no carried event context, the system shall land on the host default landing and register nothing", async () => {
    // 008 EARS-7, amended 2026-08-17 by 013 EARS-15 (008 requirements →
    // Amendment): the post-login default landing is the discovery listing, never
    // the marketing landing and never a scaffold or a dead dashboard.
    await expect(completeReturnTarget(null, ACADEMY)).resolves.toBe("/webinars");
    await expect(completeReturnTarget(null, DOCTOR)).resolves.toBe("/events");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: a cross-origin / open-redirect return target shall be rejected — nothing registers, nothing navigates off-origin", async () => {
    for (const evil of [
      "https://evil.example/webinars/x",
      "//evil.example",
      "/\\evil.example",
      "/webinars/../account",
      "/webinars/%2e%2e/account",
    ]) {
      // Dropped before any branch can navigate to it → the safe default landing.
      await expect(completeReturnTarget(evil, ACADEMY)).resolves.toBe(
        "/webinars",
      );
    }
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("013 EARS-15: the site root is not a return target — no post-login flow lands a doctor on the marketing landing", async () => {
    // The live US-10 regression this clause repairs: the root no longer redirects
    // to the discovery listing (it serves the marketing landing), so a root
    // default stranded a doctor on marketing copy after login.
    await expect(completeReturnTarget("/", ACADEMY)).resolves.toBe("/webinars");
    await expect(completeReturnTarget("/", DOCTOR)).resolves.toBe("/events");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("014 EARS-6: any OTHER login-gated same-origin page is honoured as the landing, and registers nothing", async () => {
    // The platform-wide rule (014 EARS-6, design §6). Before this clause a
    // same-origin page that was neither the event page nor the room was dropped
    // to the default listing — the stranded-after-login defect the owner rule of
    // 2026-08-17 forbids. There is no event in these targets, so no
    // RegisterForEvent fires; the visitor is simply returned to their origin.
    for (const page of ["/account", "/account/events", "/webinars/a/b"]) {
      await expect(completeReturnTarget(page, ACADEMY)).resolves.toBe(page);
    }
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: a failing register call still lands the doctor on the event page (best-effort — never stranded off the chosen event)", async () => {
    registerForEvent.mockRejectedValueOnce(new Error("boom"));
    await expect(
      completeReturnTarget("/webinars/ahilles-042", ACADEMY),
    ).resolves.toBe("/webinars/ahilles-042");
  });

  it("006 EARS-6: a room-return target lands back on the ROOM url and fires NO registration (the gate re-evaluates on return)", async () => {
    // An unauthenticated visitor bounced from the room carries a /room returnTo.
    // On login success the doctor returns to the room URL so the server-side gate
    // RE-RUNS — the room feature never silently registers them (an unregistered
    // doctor is then guided to register by the re-evaluation, not auto-admitted).
    const landing = await completeReturnTarget(
      "/webinars/ahilles-042/room",
      ACADEMY,
    );
    expect(landing).toBe("/webinars/ahilles-042/room");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("019 EARS-12: a target of the OTHER storefront shape is not an intent for this host — it registers nothing and never becomes this host event page", async () => {
    // The 019 feed shape and the doctor event page are paths on the DOCTOR host.
    // The academy projection completes only academy-shaped intents: no
    // RegisterForEvent may fire for a slug this host never showed, and the value
    // must not come back out as an event-page landing.
    for (const foreign of [
      "/events?tense=upcoming&resume=abc",
      "/events?resume=ahilles-042",
      "/events?tense=upcoming&resume=abc/room",
    ]) {
      const landing = await completeReturnTarget(foreign, ACADEMY);
      expect(
        registerForEvent,
        `must not register: ${foreign}`,
      ).not.toHaveBeenCalled();
      // Never the 005 event page — the intent branch did not run.
      expect(landing.startsWith("/webinars/")).toBe(false);
    }
  });

  it("005 EARS-2: currentReturnTarget reads the carried returnTo off the current URL query", () => {
    window.history.replaceState(
      null,
      "",
      "/login?returnTo=%2Fwebinars%2Fahilles-042",
    );
    expect(currentReturnTarget()).toBe("/webinars/ahilles-042");

    window.history.replaceState(null, "", "/login");
    expect(currentReturnTarget()).toBeNull();
  });
});

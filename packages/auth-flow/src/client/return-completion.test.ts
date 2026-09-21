// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// 014 EARS-6 / 005 EARS-2 — the host-config projection of the shared
// completion-on-return rule. The rule's branches are proven once in
// `@ds/events-storefront` (`src/client/registration-resume.test.ts`); what this
// host owns, and what is therefore asserted here, is the CARRY side that cannot
// be shared: the per-origin parked target is consumed exactly once on the way
// out, and the academy's own shapes and default landing are the configuration
// handed to the shared rule.

const { registerForEvent } = vi.hoisted(() => ({ registerForEvent: vi.fn() }));
vi.mock("@ds/events-storefront/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/client")>()),
  registerForEvent,
}));

import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { clearStoredReturnTarget } from "./return-target-store";

const ACADEMY_PARKING = ACADEMY_FIXTURE.returnTo!.parkingCookie!;
import { completeReturnTarget } from "./return-completion";

/** Park a target the way the auth-flow entry does: the same-origin cookie. */
function park(target: string) {
  document.cookie = `${ACADEMY_PARKING.name}=${encodeURIComponent(target)}; Path=/`;
}

beforeEach(() => {
  registerForEvent.mockReset();
  registerForEvent.mockResolvedValue({ registered: true });
  clearStoredReturnTarget(ACADEMY_PARKING);
});

describe("014 EARS-6 academy return-target consumption (registration resume)", () => {
  it("014 EARS-6: a target parked when the visitor entered the auth flow survives the trip and completes the carried registration", async () => {
    // The verification-mail round-trip drops the query string, so the parked
    // value is the ONLY carrier left by the time the session exists.
    park("/webinars/ahilles-042");

    await expect(completeReturnTarget(ACADEMY_FIXTURE, null)).resolves.toBe(
      "/webinars/ahilles-042",
    );
    expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
  });

  it("014 EARS-6: the parked target is consumed ONCE — a later unrelated sign-in lands on the academy default, not a stale page", async () => {
    park("/webinars/ahilles-042");
    await completeReturnTarget(ACADEMY_FIXTURE, null);
    registerForEvent.mockClear();

    await expect(completeReturnTarget(ACADEMY_FIXTURE, null)).resolves.toBe("/webinars");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("013 EARS-15: with no carried target this host lands on `/webinars`, never on the Academy marketing landing", async () => {
    await expect(completeReturnTarget(ACADEMY_FIXTURE, "/")).resolves.toBe("/webinars");
    await expect(completeReturnTarget(ACADEMY_FIXTURE, null)).resolves.toBe("/webinars");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: a hostile cross-origin target is dropped by this host's guard before the shared rule ever sees it", async () => {
    await expect(
      completeReturnTarget(ACADEMY_FIXTURE, "https://evil.example/webinars/x"),
    ).resolves.toBe("/webinars");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("006 EARS-6: the academy room shape is this host's configuration — a room return lands on the room and registers nothing", async () => {
    await expect(
      completeReturnTarget(ACADEMY_FIXTURE, "/webinars/ahilles-042/room"),
    ).resolves.toBe("/webinars/ahilles-042/room");
    expect(registerForEvent).not.toHaveBeenCalled();
  });
});

describe("013 EARS-15: the server-resolved default landing (doctor specialty feed)", () => {
  it("013 EARS-15: a caller-supplied default landing stands in for `landing.afterLogin` when nothing was carried", async () => {
    // The doctor storefront decides the landing per visitor on the SERVER
    // (`landing.specialtyAware`: a remembered specialty lands on `/events`, not
    // on the static `/`). The door hands that decision back rather than letting
    // the package recompute it.
    await expect(
      completeReturnTarget(DOCTOR_FIXTURE, null, "/events"),
    ).resolves.toBe("/events");
  });

  it("013 EARS-15: a carried target still outranks the supplied default landing", async () => {
    await expect(
      completeReturnTarget(DOCTOR_FIXTURE, "/events/cardio-live", "/events"),
    ).resolves.toBe("/events/cardio-live");
    expect(registerForEvent).toHaveBeenCalledWith("cardio-live");
  });

  it("013 EARS-15: without a supplied default the host's own `landing.afterLogin` stands", async () => {
    await expect(completeReturnTarget(DOCTOR_FIXTURE, null)).resolves.toBe("/");
  });
});

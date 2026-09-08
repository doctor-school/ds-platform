import { beforeEach, describe, expect, it, vi } from "vitest";

// 014 EARS-6 / 005 EARS-2 — the ACADEMY projection of the shared
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

import { completeReturnTarget } from "./registration-resume";
import {
  RETURN_TARGET_COOKIE,
  clearStoredReturnTarget,
} from "./return-to-origin";

/** Park a target the way the auth-flow entry does: the same-origin cookie. */
function park(target: string) {
  document.cookie = `${RETURN_TARGET_COOKIE}=${encodeURIComponent(target)}; Path=/`;
}

beforeEach(() => {
  registerForEvent.mockReset();
  registerForEvent.mockResolvedValue({ registered: true });
  clearStoredReturnTarget();
});

describe("014 EARS-6 academy return-target consumption (registration resume)", () => {
  it("014 EARS-6: a target parked when the visitor entered the auth flow survives the trip and completes the carried registration", async () => {
    // The verification-mail round-trip drops the query string, so the parked
    // value is the ONLY carrier left by the time the session exists.
    park("/webinars/ahilles-042");

    await expect(completeReturnTarget(null)).resolves.toBe(
      "/webinars/ahilles-042",
    );
    expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
  });

  it("014 EARS-6: the parked target is consumed ONCE — a later unrelated sign-in lands on the academy default, not a stale page", async () => {
    park("/webinars/ahilles-042");
    await completeReturnTarget(null);
    registerForEvent.mockClear();

    await expect(completeReturnTarget(null)).resolves.toBe("/webinars");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("013 EARS-15: with no carried target this host lands on `/webinars`, never on the Academy marketing landing", async () => {
    await expect(completeReturnTarget("/")).resolves.toBe("/webinars");
    await expect(completeReturnTarget(null)).resolves.toBe("/webinars");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: a hostile cross-origin target is dropped by this host's guard before the shared rule ever sees it", async () => {
    await expect(
      completeReturnTarget("https://evil.example/webinars/x"),
    ).resolves.toBe("/webinars");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("006 EARS-6: the academy room shape is this host's configuration — a room return lands on the room and registers nothing", async () => {
    await expect(
      completeReturnTarget("/webinars/ahilles-042/room"),
    ).resolves.toBe("/webinars/ahilles-042/room");
    expect(registerForEvent).not.toHaveBeenCalled();
  });
});

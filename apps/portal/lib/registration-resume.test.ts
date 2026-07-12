import { beforeEach, describe, expect, it, vi } from "vitest";

// 005 EARS-2 — the RESUME side of the guest-through-auth completion: once the
// 003 session exists, the carried registration-intent fires the SAME
// `RegisterForEvent` (EARS-1) and the doctor lands back on the originally chosen
// event page registered — no re-search, no second «Участвовать» tap. A hostile
// (cross-origin / open-redirect) returnTo never completes anything and never
// becomes a navigation target (requirements Constraints; design §3.2).
//
// The register client is mocked: EARS-2 owns the carry + resume mechanics; the
// command's server semantics are EARS-1/EARS-3 (already shipped).

const { registerForEvent } = vi.hoisted(() => ({
  registerForEvent: vi.fn(),
}));
vi.mock("./registration-client", () => ({ registerForEvent }));

import {
  completeReturnTarget,
  currentReturnTarget,
} from "./registration-resume";

beforeEach(() => {
  registerForEvent.mockReset();
  registerForEvent.mockResolvedValue({
    registered: true,
    registeredAt: "2026-07-08T10:00:00+00:00",
  });
});

describe("005 EARS-2 guest-through-auth completion (registration resume)", () => {
  it("EARS-2: when auth succeeds with a carried event context, the system shall fire RegisterForEvent for that same event and land on that event page", async () => {
    const landing = await completeReturnTarget("/webinars/ahilles-042");

    // The SAME EARS-1 command fires for the carried slug…
    expect(registerForEvent).toHaveBeenCalledTimes(1);
    expect(registerForEvent).toHaveBeenCalledWith("ahilles-042");
    // …and the doctor lands back on the originally chosen event page — no
    // re-search, no second «Участвовать» tap.
    expect(landing).toBe("/webinars/ahilles-042");
  });

  it("EARS-2: with no carried event context, the system shall land on the default /account/events and register nothing", async () => {
    await expect(completeReturnTarget(null)).resolves.toBe("/account/events");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: a cross-origin / open-redirect return target shall be rejected — nothing registers, nothing navigates off-origin", async () => {
    for (const evil of [
      "https://evil.example/webinars/x",
      "//evil.example",
      "/\\evil.example",
      "/account", // same-origin but not an event return target
      "/webinars/../account",
    ]) {
      await expect(completeReturnTarget(evil)).resolves.toBe("/account/events");
    }
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: a failing register call still lands the doctor on the event page (best-effort — never stranded off the chosen event)", async () => {
    registerForEvent.mockRejectedValueOnce(new Error("boom"));
    await expect(completeReturnTarget("/webinars/ahilles-042")).resolves.toBe(
      "/webinars/ahilles-042",
    );
  });

  it("006 EARS-6: a room-return target lands back on the ROOM url and fires NO registration (the gate re-evaluates on return)", async () => {
    // An unauthenticated visitor bounced from the room carries a `/room` returnTo.
    // On login success the doctor returns to the room URL so the server-side gate
    // RE-RUNS — the room feature never silently registers them (an unregistered
    // doctor is then guided to register by the re-evaluation, not auto-admitted).
    const landing = await completeReturnTarget("/webinars/ahilles-042/room");
    expect(landing).toBe("/webinars/ahilles-042/room");
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("EARS-2: currentReturnTarget reads the carried returnTo off the current URL query", () => {
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

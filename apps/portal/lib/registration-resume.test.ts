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

  it("008 EARS-7: with no carried event context, the system shall land on the discovery listing `/webinars` (post-login landing) and register nothing", async () => {
    // 008 EARS-7, amended 2026-08-17 by 013 EARS-15 (008 requirements →
    // Amendment): the post-login default landing is the discovery listing
    // `/webinars`, never `/` (the Academy landing) and never a scaffold or a dead
    // dashboard. Supersedes the #769 `/account/events` default.
    await expect(completeReturnTarget(null)).resolves.toBe("/webinars");
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
      // Dropped by the guard → falls back to the safe default discovery listing
      // (`/webinars`), never the attacker's target (008 EARS-7 default landing as
      // amended by 013 EARS-15).
      await expect(completeReturnTarget(evil)).resolves.toBe("/webinars");
    }
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("013 EARS-15: with no valid return target the landing shall be `/webinars` — no post-login flow lands a doctor on the Academy landing `/`", async () => {
    // The live US-10 regression this clause repairs: `/` no longer redirects to the
    // discovery listing (it serves the Academy landing), so a `/` default stranded a
    // doctor on marketing copy after login. The default is the discovery listing.
    for (const raw of [null, "", "/", "https://evil.example/webinars/x", "//evil.example"]) {
      await expect(completeReturnTarget(raw)).resolves.toBe("/webinars");
    }
  });

  it("013 EARS-15: a captured SAFE same-origin return target still wins over the default landing", async () => {
    // The return-to-origin mechanism itself is feature 014's (#1342); 013 changes
    // only the default, so a target the shipped same-origin guards accept — the
    // event page (005 EARS-2) and the room (006 EARS-6) — is still honoured.
    await expect(completeReturnTarget("/webinars/ahilles-042")).resolves.toBe(
      "/webinars/ahilles-042",
    );
    await expect(
      completeReturnTarget("/webinars/ahilles-042/room"),
    ).resolves.toBe("/webinars/ahilles-042/room");
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

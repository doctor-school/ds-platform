import { describe, expect, it } from "vitest";

import { applyPresenceCountPublication } from "./presence-channel";

/**
 * 006 EARS-5 — the PURE half of the realtime presence-count push: the
 * discriminate-and-apply seam on the shared `room:event:<id>` channel, which
 * carries chat and presence over ONE connection.
 *
 * The provider-wiring render (a published count reaching the header instantly
 * through `RoomPresenceProvider`) stays in the host until the room composition
 * moves — `apps/portal/app/webinars/[slug]/room/presence-channel.test.tsx`. It
 * cannot live here: it is JSX over a portal-owned provider and mocks `next-intl`,
 * both of which `../purity.test.ts` forbids and the `ui → client → model` direction
 * rules out.
 */

const presence = (count: number) => ({
  type: "presence-count",
  count,
  at: "2026-07-13T10:00:00.000Z",
});

const chatMessage = {
  id: "6f9b2f1e-8f1a-4b7e-9c3d-2a1b3c4d5e6f",
  authorTag: "B2",
  text: "Здравствуйте!",
  at: "2026-07-13T10:00:00.000Z",
};

describe("006 EARS-5 applyPresenceCountPublication — one channel, two shapes", () => {
  it("006 EARS-5: a server-published count is applied and claimed", () => {
    const applied: number[] = [];
    expect(applyPresenceCountPublication(presence(4), (n) => applied.push(n))).toBe(
      true,
    );
    expect(applied).toEqual([4]);
  });

  it("006 EARS-5: a published age-out to zero is applied, not swallowed", () => {
    const applied: number[] = [];
    expect(applyPresenceCountPublication(presence(0), (n) => applied.push(n))).toBe(
      true,
    );
    expect(applied).toEqual([0]);
  });

  it("006 EARS-5: a chat message never cross-parses as a count — it is left for the chat handler", () => {
    const applied: number[] = [];
    expect(applyPresenceCountPublication(chatMessage, (n) => applied.push(n))).toBe(
      false,
    );
    expect(applied).toEqual([]);
  });

  it("006 EARS-5: malformed or absent channel data degrades to the heartbeat-ack path, never a throw", () => {
    const applied: number[] = [];
    const apply = (n: number) => applied.push(n);
    expect(applyPresenceCountPublication({ unexpected: true }, apply)).toBe(false);
    expect(applyPresenceCountPublication(null, apply)).toBe(false);
    expect(applyPresenceCountPublication(undefined, apply)).toBe(false);
    expect(applyPresenceCountPublication({ type: "presence-count" }, apply)).toBe(false);
    expect(applied).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { applyPresenceCountPublication } from "./presence-channel";
import {
  PresenceCount,
  RoomPresenceProvider,
  usePresenceCountSetter,
} from "./room-presence";

/**
 * 006 EARS-5 — the realtime presence-count push CLIENT path. A server-published
 * count arriving on the shared room channel must update the header «N врачей в
 * комнате» INSTANTLY (no reload, no waiting on the observer's own beat), it must
 * never cross-parse a chat message, and when the channel is unavailable the count
 * must degrade to the heartbeat-ack refresh path (#1136) — never freeze. The
 * server aggregate itself is proven in `apps/api`; the two-doctor fan-out in the
 * live Playwright pair-check. Here we lock the discriminate-and-apply seam + the
 * provider wiring `room-chat.tsx` drives from its Centrifugo publication handler.
 */
vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, opts?: { count?: number }) =>
      opts && typeof opts.count === "number" ? `${key}:${opts.count}` : key,
}));

let setCount: (n: number) => void = () => {};
function Capture(): null {
  setCount = usePresenceCountSetter();
  return null;
}

function renderHeader(initialCount = 1): void {
  render(
    <RoomPresenceProvider initialCount={initialCount}>
      <PresenceCount />
      <Capture />
    </RoomPresenceProvider>,
  );
}

function count(): string | null {
  return screen.queryByTestId("room-presence-count")?.textContent ?? null;
}

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

describe("006 EARS-5 realtime presence-count client push", () => {
  afterEach(() => vi.restoreAllMocks());

  it("EARS-5: a server-published count updates the header instantly, with no beat", () => {
    renderHeader(1);
    let applied = false;
    act(() => {
      applied = applyPresenceCountPublication(presence(4), setCount);
    });
    expect(applied).toBe(true);
    expect(count()).toBe("presenceCount:4");
  });

  it("EARS-5: a published leave brings the header down to zero (the count then hides)", () => {
    renderHeader(3);
    act(() => {
      applyPresenceCountPublication(presence(0), setCount);
    });
    // PresenceCount hides at count <= 0 — a room that emptied out shows no «0 …».
    expect(count()).toBeNull();
  });

  it("EARS-5: a chat message is NOT applied as a count (discriminator) — the header holds", () => {
    renderHeader(2);
    let applied = true;
    act(() => {
      applied = applyPresenceCountPublication(chatMessage, setCount);
    });
    expect(applied).toBe(false);
    expect(count()).toBe("presenceCount:2");
  });

  it("EARS-5: malformed channel data is ignored — the header never breaks", () => {
    renderHeader(2);
    act(() => {
      expect(applyPresenceCountPublication({ unexpected: true }, setCount)).toBe(
        false,
      );
      expect(applyPresenceCountPublication(null, setCount)).toBe(false);
    });
    expect(count()).toBe("presenceCount:2");
  });

  it("EARS-5: degrades to the heartbeat-ack refresh — after a published count, an ack-path update still lands (never frozen)", () => {
    renderHeader(1);
    // Channel healthy: the published value wins.
    act(() => {
      applyPresenceCountPublication(presence(5), setCount);
    });
    expect(count()).toBe("presenceCount:5");
    // Channel now unavailable → no publications; the heartbeat-ack path (#1136)
    // keeps refreshing the SAME provider, so the count never freezes on 5.
    act(() => setCount(3));
    expect(count()).toBe("presenceCount:3");
  });
});

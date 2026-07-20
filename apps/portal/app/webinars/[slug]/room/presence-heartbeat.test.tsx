import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PresenceHeartbeat } from "./presence-heartbeat";
import { PresenceCount, RoomPresenceProvider } from "./room-presence";

/**
 * 006 EARS-5 (#1122) — the live «N врачей в комнате» count must refresh from
 * EVERY accepted heartbeat ack, with NO page reload, and a FAILED beat must leave
 * a diagnostic breadcrumb instead of vanishing silently.
 *
 * This wires the three real modules exactly as `page.tsx` does
 * ({@link RoomPresenceProvider} + {@link PresenceCount} + {@link PresenceHeartbeat})
 * and drives the N-second beat grid with fake timers. The server aggregate itself
 * (distinct-doctor count, tab-coalescing, freshness-window age-out) is proven by
 * `apps/api/test/room/presence-count.e2e-spec.ts`; here we lock the CLIENT push
 * path — the loop pushing each ack's count into the header — and the cadence
 * mechanism that made #1122 read as "frozen without a reload".
 */
vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, opts?: { count?: number }) =>
      opts && typeof opts.count === "number" ? `${key}:${opts.count}` : key,
}));

const slug = "hsn-therapy";
const eventId = "6f9b2f1e-8f1a-4b7e-9c3d-2a1b3c4d5e6f";

function ack(presenceCount: number): Response {
  return {
    ok: true,
    json: () =>
      Promise.resolve({ eventId, beatAt: new Date().toISOString(), presenceCount }),
  } as unknown as Response;
}

/** A refused beat (server-side gate / closed room) — `res.ok` false. */
function nonOk(status: number): Response {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response;
}

/** An ok response whose body no longer matches the ack contract (schema drift). */
function badShape(): Response {
  return { ok: true, json: () => Promise.resolve({ unexpected: true }) } as unknown as Response;
}

function renderRoom(intervalSeconds = 60): void {
  render(
    <RoomPresenceProvider initialCount={1}>
      <PresenceCount />
      <PresenceHeartbeat slug={slug} intervalSeconds={intervalSeconds} />
    </RoomPresenceProvider>,
  );
}

/** Drain the beat's microtask chain (fetch → await json → setState) under fake timers. */
async function flushBeat(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

function count(): string | null {
  return screen.queryByTestId("room-presence-count")?.textContent ?? null;
}

describe("006 EARS-5 live presence count refresh (#1122)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("EARS-5: the header count increments from a later beat's ack without a reload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ack(1))
      .mockResolvedValueOnce(ack(2));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom(60);
    await flushBeat();
    expect(count()).toBe("presenceCount:1");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flushBeat();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(count()).toBe("presenceCount:2");
  });

  it("EARS-5: the header count reflects a leave — a later ack with a lower count decrements without a reload", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ack(2))
      .mockResolvedValueOnce(ack(1));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom(60);
    await flushBeat();
    expect(count()).toBe("presenceCount:2");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flushBeat();
    expect(count()).toBe("presenceCount:1");
  });

  it("EARS-5: between beats the count holds — a join is invisible until the observer's own next beat lands (the cadence gap #1122 reads as 'frozen')", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(ack(1))
      .mockResolvedValueOnce(ack(2));
    vi.stubGlobal("fetch", fetchMock);

    renderRoom(60);
    await flushBeat();
    expect(count()).toBe("presenceCount:1");

    // One second short of the cadence: the second doctor has already joined
    // server-side, but the observer has sent NO new beat, so the header cannot
    // know yet — exactly the "не меняется без перезагрузки" perception.
    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    await flushBeat();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(count()).toBe("presenceCount:1");

    // Crossing the cadence sends the next beat, and only then does the count move.
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await flushBeat();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(count()).toBe("presenceCount:2");
  });

  it("EARS-5: a failed beat surfaces a diagnostic instead of vanishing silently, and the loop recovers on the next good beat", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("network down")) // mount beat — .catch path
      .mockResolvedValueOnce(nonOk(503)) // refused beat — !res.ok path
      .mockResolvedValueOnce(badShape()) // schema drift — safeParse failure path
      .mockResolvedValueOnce(ack(4)); // a good beat still lands
    vi.stubGlobal("fetch", fetchMock);

    renderRoom(60);
    await flushBeat();
    // The count holds its seeded value (best-effort: a failed beat never clears it),
    // but the failure is no longer swallowed with zero signal.
    expect(count()).toBe("presenceCount:1");
    expect(debug).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flushBeat();
    expect(debug).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flushBeat();
    expect(debug).toHaveBeenCalledTimes(3);

    // A subsequent good beat recovers the live count — the diagnostic never breaks
    // the best-effort loop.
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flushBeat();
    expect(count()).toBe("presenceCount:4");
    expect(debug).toHaveBeenCalledTimes(3);
  });
});

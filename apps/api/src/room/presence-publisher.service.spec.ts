import { afterEach, describe, expect, it, vi } from "vitest";
import type { CentrifugoChatGateway } from "./chat.gateway.js";
import type { PresenceRepository } from "./presence.repository.js";
import { PresencePublisher } from "./presence-publisher.service.js";

/**
 * 006 EARS-5 — the realtime presence-count publisher (design §5). It fans the
 * server-authoritative distinct-doctor count out over the room's Centrifugo channel
 * ONLY when a beat or a window expiry CHANGES it, and never in the beat's critical
 * path (every failure is swallowed so the heartbeat-ack refresh #1136 stays the
 * fallback). This pins that logic against a fake gateway + repository — no
 * Centrifugo, no Postgres — mirroring the mock style the chat path uses; the
 * end-to-end two-doctor fan-out is proven by the live Playwright pair-check.
 */

const EVENT = "6f9b2f1e-8f1a-4b7e-9c3d-2a1b3c4d5e6f";
const N = 60; // heartbeat cadence; window = 2 × N = 120 s

function makeGateway(enabled = true) {
  return {
    enabled,
    publishPresenceCount: vi.fn<CentrifugoChatGateway["publishPresenceCount"]>(
      () => Promise.resolve(),
    ),
  };
}

function makeRepo() {
  return {
    countLivePresence: vi.fn<PresenceRepository["countLivePresence"]>(),
    nextPresenceExpiry: vi.fn<PresenceRepository["nextPresenceExpiry"]>(
      () => Promise.resolve(null),
    ),
  };
}

function makePublisher(
  gateway: ReturnType<typeof makeGateway>,
  repo: ReturnType<typeof makeRepo>,
): PresencePublisher {
  return new PresencePublisher(
    gateway as unknown as CentrifugoChatGateway,
    repo as unknown as PresenceRepository,
    N,
  );
}

describe("006 EARS-5 realtime presence-count publisher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("EARS-5: an accepted beat that changes the count publishes it to the room channel", async () => {
    const gateway = makeGateway();
    const publisher = makePublisher(gateway, makeRepo());

    await publisher.onBeat(EVENT, 2);

    expect(gateway.publishPresenceCount).toHaveBeenCalledTimes(1);
    expect(gateway.publishPresenceCount).toHaveBeenCalledWith(EVENT, 2);
    publisher.onModuleDestroy();
  });

  it("EARS-5: an unchanged count is NOT re-published (a steady room emits nothing)", async () => {
    const gateway = makeGateway();
    const publisher = makePublisher(gateway, makeRepo());

    await publisher.onBeat(EVENT, 2);
    await publisher.onBeat(EVENT, 2);
    await publisher.onBeat(EVENT, 2);

    expect(gateway.publishPresenceCount).toHaveBeenCalledTimes(1);
    publisher.onModuleDestroy();
  });

  it("EARS-5: a later beat that raises the count (a join) publishes the new value", async () => {
    const gateway = makeGateway();
    const publisher = makePublisher(gateway, makeRepo());

    await publisher.onBeat(EVENT, 2);
    await publisher.onBeat(EVENT, 3);

    expect(gateway.publishPresenceCount).toHaveBeenCalledTimes(2);
    expect(gateway.publishPresenceCount).toHaveBeenNthCalledWith(1, EVENT, 2);
    expect(gateway.publishPresenceCount).toHaveBeenNthCalledWith(2, EVENT, 3);
    publisher.onModuleDestroy();
  });

  it("EARS-5: a window expiry (a leave) publishes the decreased count without any beat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:00.000Z"));
    const gateway = makeGateway();
    const repo = makeRepo();
    // Arm at +500 ms on the beat, then no further age-out to schedule.
    repo.nextPresenceExpiry
      .mockResolvedValueOnce(new Date(Date.now() + 500))
      .mockResolvedValue(null);
    // When the timer fires, the soonest doctor has aged out: 2 → 1.
    repo.countLivePresence.mockResolvedValue(1);
    const publisher = makePublisher(gateway, repo);

    await publisher.onBeat(EVENT, 2);
    expect(gateway.publishPresenceCount).toHaveBeenCalledWith(EVENT, 2);

    // No further beat — only time passing past the window expiry.
    await vi.advanceTimersByTimeAsync(600);

    expect(repo.countLivePresence).toHaveBeenCalledWith(EVENT, 120);
    expect(gateway.publishPresenceCount).toHaveBeenLastCalledWith(EVENT, 1);
    expect(gateway.publishPresenceCount).toHaveBeenCalledTimes(2);
    publisher.onModuleDestroy();
  });

  it("EARS-5: with Centrifugo unconfigured the publisher is inert — no publish, no timer, no throw (ack-path fallback)", async () => {
    const gateway = makeGateway(false);
    const repo = makeRepo();
    const publisher = makePublisher(gateway, repo);

    await expect(publisher.onBeat(EVENT, 2)).resolves.toBeUndefined();

    expect(gateway.publishPresenceCount).not.toHaveBeenCalled();
    expect(repo.nextPresenceExpiry).not.toHaveBeenCalled();
    publisher.onModuleDestroy();
  });

  it("EARS-5: a publish failure is swallowed (never breaks the beat) and retried on the next change", async () => {
    const gateway = makeGateway();
    gateway.publishPresenceCount
      .mockRejectedValueOnce(new Error("centrifugo down"))
      .mockResolvedValue();
    const publisher = makePublisher(gateway, makeRepo());

    // The first publish rejects — onBeat still resolves, and the count is NOT
    // latched as published, so an identical count is retried next time.
    await expect(publisher.onBeat(EVENT, 2)).resolves.toBeUndefined();
    await publisher.onBeat(EVENT, 2);

    expect(gateway.publishPresenceCount).toHaveBeenCalledTimes(2);
    publisher.onModuleDestroy();
  });
});

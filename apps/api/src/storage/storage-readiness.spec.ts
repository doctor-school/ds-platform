import type { SchedulerRegistry } from "@nestjs/schedule";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ObjectStorageReadiness,
  STORAGE_PROBE_TIMEOUT_MS,
} from "./storage-readiness.js";
import type { ObjectStorage, StorageProbeResult } from "./storage.types.js";

/** A port whose probe answers from a queue (last answer repeats). */
function storageAnswering(
  ...answers: Array<StorageProbeResult | Promise<StorageProbeResult>>
): ObjectStorage & { calls: number } {
  const port = {
    calls: 0,
    probe() {
      const answer = answers[Math.min(port.calls, answers.length - 1)];
      port.calls += 1;
      return Promise.resolve(answer as StorageProbeResult);
    },
  };
  return port as unknown as ObjectStorage & { calls: number };
}

/** Live intervals of the most recent {@link registryStub}. */
let intervals = new Map<string, ReturnType<typeof setInterval>>();

function registryStub(): SchedulerRegistry {
  intervals = new Map();
  const live = intervals;
  return {
    addInterval: (name: string, h: ReturnType<typeof setInterval>) =>
      live.set(name, h),
    getIntervals: () => [...live.keys()],
    deleteInterval: (name: string) => {
      clearInterval(live.get(name));
      live.delete(name);
    },
  } as unknown as SchedulerRegistry;
}

function sinks() {
  return {
    warn: vi.fn<(l: string) => void>(),
    log: vi.fn<(l: string) => void>(),
  };
}

const DOWN: StorageProbeResult = {
  ok: false,
  reason: "InvalidAccessKeyId (HTTP 403)",
};

describe("002 EARS-3 cached object-storage readiness (#2821)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("EARS-3: probes at startup and holds the result; the endpoint reads the cache without probing", async () => {
    const storage = storageAnswering(DOWN);
    const out = sinks();
    const monitor = new ObjectStorageReadiness(
      storage,
      60_000,
      registryStub(),
      out,
    );

    await monitor.onModuleInit();
    expect(storage.calls).toBe(1);
    expect(monitor.status()).toBe("down");
    expect(monitor.status()).toBe("down");
    expect(storage.calls).toBe(1);
    expect(out.warn).toHaveBeenCalledWith(
      expect.stringContaining("InvalidAccessKeyId (HTTP 403)"),
    );
    monitor.onModuleDestroy();
  });

  it("EARS-3: refreshes every interval, logs WARN only on the transition to down and LOG on recovery — not every tick", async () => {
    vi.useFakeTimers();
    const storage = storageAnswering({ ok: true }, DOWN, DOWN, DOWN, {
      ok: true,
    });
    const out = sinks();
    const monitor = new ObjectStorageReadiness(
      storage,
      60_000,
      registryStub(),
      out,
    );

    await monitor.onModuleInit();
    expect(monitor.status()).toBe("ok");
    expect(out.warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(monitor.status()).toBe("down");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(storage.calls).toBe(4);
    expect(out.warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(monitor.status()).toBe("ok");
    expect(out.log).toHaveBeenLastCalledWith(
      expect.stringContaining("recovered"),
    );
    expect(out.warn).toHaveBeenCalledTimes(1);

    monitor.onModuleDestroy();
    expect(intervals.size).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(storage.calls).toBe(5);
  });

  it("EARS-3: an overlapping tick is skipped while a probe is still in flight", async () => {
    vi.useFakeTimers();
    let release!: (r: StorageProbeResult) => void;
    const slow = new Promise<StorageProbeResult>((r) => {
      release = r;
    });
    let calls = 0;
    const storage = {
      probe: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve({ ok: true } as const) : slow;
      },
    } as unknown as ObjectStorage;
    const monitor = new ObjectStorageReadiness(
      storage,
      1_000,
      registryStub(),
      sinks(),
    );

    await monitor.onModuleInit();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    release({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(3);
    monitor.onModuleDestroy();
  });

  it("EARS-3: a probe that never answers is down after the probe timeout", async () => {
    vi.useFakeTimers();
    const storage = {
      probe: () => new Promise<StorageProbeResult>(() => undefined),
    } as unknown as ObjectStorage;
    const out = sinks();
    const monitor = new ObjectStorageReadiness(
      storage,
      60_000,
      registryStub(),
      out,
    );

    const init = monitor.onModuleInit();
    await vi.advanceTimersByTimeAsync(STORAGE_PROBE_TIMEOUT_MS);
    await init;
    expect(monitor.status()).toBe("down");
    expect(out.warn).toHaveBeenCalledWith(expect.stringContaining("timed out"));
    monitor.onModuleDestroy();
  });
});

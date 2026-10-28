import { describe, expect, it, vi } from "vitest";

import { runBootstrap } from "./run-bootstrap.js";

function deps(flush: (timeoutMs: number) => Promise<unknown> = () => Promise.resolve(true)) {
  return {
    exit: vi.fn(),
    capture: vi.fn(),
    flush: vi.fn(flush),
    log: vi.fn(),
  };
}

describe("runBootstrap", () => {
  it("3412: a boot that rejects logs the error, captures it, flushes, then exits non-zero", async () => {
    const d = deps();
    const failure = new Error("connect EHOSTUNREACH 192.168.0.10:5432");

    await runBootstrap(() => Promise.reject(failure), d);

    expect(d.log).toHaveBeenCalledWith(expect.any(String), failure);
    expect(d.capture).toHaveBeenCalledWith(failure);
    expect(d.flush).toHaveBeenCalledTimes(1);
    expect(d.exit).toHaveBeenCalledTimes(1);
    expect(d.exit.mock.calls[0]?.[0]).not.toBe(0);
    expect(d.log.mock.invocationCallOrder[0]).toBeLessThan(d.capture.mock.invocationCallOrder[0]!);
    expect(d.capture.mock.invocationCallOrder[0]).toBeLessThan(d.flush.mock.invocationCallOrder[0]!);
    expect(d.flush.mock.invocationCallOrder[0]).toBeLessThan(d.exit.mock.invocationCallOrder[0]!);
  });

  it("3412: a boot that resolves never exits", async () => {
    const d = deps();

    await runBootstrap(() => Promise.resolve(), d);

    expect(d.exit).not.toHaveBeenCalled();
    expect(d.capture).not.toHaveBeenCalled();
    expect(d.flush).not.toHaveBeenCalled();
  });

  it("3412: a flush that never settles still exits within the bound", async () => {
    vi.useFakeTimers();
    try {
      const d = deps(() => new Promise(() => {}));

      const done = runBootstrap(() => Promise.reject(new Error("boom")), {
        ...d,
        flushTimeoutMs: 2000,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await done;

      expect(d.exit).toHaveBeenCalledTimes(1);
      expect(d.exit.mock.calls[0]?.[0]).not.toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("3412: a flush that rejects still exits non-zero", async () => {
    const d = deps(() => Promise.reject(new Error("transport down")));

    await runBootstrap(() => Promise.reject(new Error("boom")), d);

    expect(d.exit).toHaveBeenCalledTimes(1);
    expect(d.exit.mock.calls[0]?.[0]).not.toBe(0);
  });
});

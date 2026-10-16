import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runGatedLoginAttempt } from "./login-failure-gate.js";

let dir: string;
let lockPath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "login-failure-gate-"));
  lockPath = path.join(dir, "gate.lock");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe("runGatedLoginAttempt (#2956)", () => {
  it("closes every attempt with a successful sign-in and releases the gate", async () => {
    const order: string[] = [];
    const result = await runGatedLoginAttempt(
      {
        lockPath,
        close: async () => {
          order.push("close");
        },
      },
      async () => {
        order.push("attempt");
        return 401;
      },
    );
    expect(result).toBe(401);
    expect(order).toEqual(["attempt", "close"]);
    expect(await exists(lockPath)).toBe(false);
  });

  it("still closes and releases when the attempt throws", async () => {
    let closed = false;
    await expect(
      runGatedLoginAttempt(
        {
          lockPath,
          close: async () => {
            closed = true;
          },
        },
        async () => {
          throw new Error("assertion inside the attempt");
        },
      ),
    ).rejects.toThrow("assertion inside the attempt");
    expect(closed).toBe(true);
    expect(await exists(lockPath)).toBe(false);
  });

  it("never lets two attempts overlap: the second waits until the first is closed", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = runGatedLoginAttempt(
      {
        lockPath,
        close: async () => {
          events.push("close-1");
        },
      },
      async () => {
        events.push("attempt-1");
        await firstHeld;
      },
    );
    // Give the first attempt time to take the gate.
    await new Promise((r) => setTimeout(r, 50));
    const second = runGatedLoginAttempt(
      {
        lockPath,
        pollMs: 5,
        close: async () => {
          events.push("close-2");
        },
      },
      async () => {
        events.push("attempt-2");
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toEqual(["attempt-1"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["attempt-1", "close-1", "attempt-2", "close-2"]);
  });

  it("takes over a gate left by a process that no longer runs", async () => {
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, "owner"), "999999999");
    let attempted = false;
    await runGatedLoginAttempt(
      {
        lockPath,
        pollMs: 5,
        isAlive: () => false,
        close: async () => {},
      },
      async () => {
        attempted = true;
      },
    );
    expect(attempted).toBe(true);
  });

  it("waits while the owning process is alive", async () => {
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, "owner"), "424242");
    let attempted = false;
    const run = runGatedLoginAttempt(
      {
        lockPath,
        pollMs: 5,
        isAlive: () => true,
        close: async () => {},
      },
      async () => {
        attempted = true;
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(attempted).toBe(false);
    await rm(lockPath, { recursive: true, force: true });
    await run;
    expect(attempted).toBe(true);
  });
});

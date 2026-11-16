import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { observeAuthoringRateStore } from "./event-authoring-isolation.js";

describe("4061 native rate-key isolation", () => {
  it("rejects shared-pepper native keys before Redis executes", async () => {
    let calls = 0;
    const pepper = "shared";
    const redis = {
      async eval(..._args: unknown[]) {
        calls++;
        return [1, 99];
      },
      async set() {
        calls++;
        return "OK";
      },
      async del() {
        calls++;
        return 1;
      },
      async exists() {
        return 0;
      },
    };
    const key = (raw: string) =>
      `ds:rate-limit:${createHmac("sha256", pepper).update(raw).digest("hex")}`;
    const store = {
      redis,
      async consume(specs: { key: string }[]) {
        return redis.eval(
          "native",
          specs.length,
          ...specs.map((s) => key(s.key)),
        );
      },
    };
    const observation = observeAuthoringRateStore(
      store,
      "owned",
      "shared",
      () => {},
    );
    await expect(store.consume([{ key: "ip:127.0.0.1" }])).rejects.toThrow(
      /disjoint/,
    );
    expect(calls).toBe(0);
    expect(observation.keys.size).toBe(0);
  });

  it("preserves actual native Redis arguments/results and cleans only observed owned keys", async () => {
    const invocations: unknown[][] = [];
    const key = (raw: string) =>
      `ds:rate-limit:${createHmac("sha256", "owned").update(raw).digest("hex")}`;
    const redis = {
      async eval(...args: unknown[]) {
        invocations.push(args);
        return [1, 99];
      },
      async set(...args: unknown[]) {
        invocations.push(args);
        return "OK";
      },
      async del(...args: unknown[]) {
        invocations.push(args);
        return 1;
      },
      async exists() {
        return 0;
      },
    };
    const store = {
      redis,
      async consume(specs: { key: string }[]) {
        return redis.eval(
          "native",
          specs.length,
          ...specs.map((s) => key(s.key)),
          123,
          1000,
          10,
        );
      },
    };
    const evidence: unknown[] = [];
    const observation = observeAuthoringRateStore(
      store,
      "owned",
      "shared",
      (row) => evidence.push(row),
    );
    expect(await store.consume([{ key: "ip:127.0.0.1" }])).toEqual([1, 99]);
    expect(invocations[0]).toEqual([
      "native",
      1,
      key("ip:127.0.0.1"),
      123,
      1000,
      10,
    ]);
    await redis.set(key("ip:127.0.0.1") + ":trip:99", "1", "PX", 1000, "NX");
    await observation.cleanup();
    expect(invocations.at(-1)).toEqual([
      key("ip:127.0.0.1"),
      key("ip:127.0.0.1") + ":trip:99",
    ]);
    expect(evidence.length).toBeGreaterThan(0);
    expect(JSON.stringify(evidence)).not.toMatch(/127\.0\.0\.1|owned|shared/);
  });
  it("requires observed keys to be absent after exact cleanup", async () => {
    const redis = {
      async eval(..._args: unknown[]) {
        return [1, 99];
      },
      async set() {
        return "OK";
      },
      async del() {
        return 0;
      },
      async exists() {
        return 1;
      },
    };
    const key = `ds:rate-limit:${createHmac("sha256", "owned").update("ip:loopback").digest("hex")}`;
    const store = {
      redis,
      async consume(_specs: { key: string }[]) {
        return redis.eval("native", 1, key);
      },
    };
    const observation = observeAuthoringRateStore(
      store,
      "owned",
      "shared",
      () => {},
    );
    await store.consume([{ key: "ip:loopback" }]);
    await expect(observation.cleanup()).rejects.toThrow(/still exist/);
  });
});

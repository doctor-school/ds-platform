import { describe, expect, it, vi } from "vitest";
import {
  FeatureFlagsService,
  type UnleashLike,
} from "./feature-flags.service.js";
import { FLAG_BOT_PROTECTION } from "./feature-flags.types.js";

/**
 * A fake Unleash SDK double. `isEnabled` mirrors the real contract: it answers
 * from a flag map when the flag is KNOWN, and returns the caller's `fallbackValue`
 * when the flag is ABSENT (the unsynchronised / unknown-toggle case the env
 * default must cover). `changed` listeners are captured so a toggle can be
 * simulated.
 */
function fakeUnleash(flags: Record<string, boolean>): {
  client: UnleashLike;
  fire: () => void;
  fireSync: () => void;
  destroyed: () => boolean;
  set: (flag: string, on: boolean) => void;
} {
  const changeListeners: Array<() => void> = [];
  const syncListeners: Array<() => void> = [];
  const listenersFor = (event: "changed" | "synchronized") =>
    event === "changed" ? changeListeners : syncListeners;
  let destroyed = false;
  const store = { ...flags };
  return {
    set: (flag, on) => {
      store[flag] = on;
    },
    fire: () => changeListeners.forEach((l) => l()),
    fireSync: () => syncListeners.forEach((l) => l()),
    destroyed: () => destroyed,
    client: {
      isEnabled: (name, _ctx, fallbackValue) =>
        name in store ? (store[name] as boolean) : (fallbackValue ?? false),
      on: (event, listener) => listenersFor(event).push(listener),
      off: (event, listener) => {
        const list = listenersFor(event);
        const i = list.indexOf(listener);
        if (i >= 0) list.splice(i, 1);
      },
      destroy: () => {
        destroyed = true;
      },
    },
  };
}

describe("FeatureFlagsService (#185 live flag reads + fallback)", () => {
  it("returns the live Unleash value when the flag is known and on", () => {
    const { client } = fakeUnleash({ [FLAG_BOT_PROTECTION]: true });
    const svc = new FeatureFlagsService(client);
    // Env default is false; live Unleash overrides it to true (precedence §4).
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, false)).toBe(true);
  });

  it("returns the live Unleash value when the flag is known and off, overriding an env-on default", () => {
    const { client } = fakeUnleash({ [FLAG_BOT_PROTECTION]: false });
    const svc = new FeatureFlagsService(client);
    // Unleash reachable + flag present (off) wins over an env default of true.
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, true)).toBe(false);
  });

  it("falls back to the env default when the flag is unknown (not yet defined in Unleash)", () => {
    const { client } = fakeUnleash({});
    const svc = new FeatureFlagsService(client);
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, true)).toBe(true);
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, false)).toBe(false);
  });

  it("falls back to the env default when Unleash is unreachable (null client)", () => {
    // The module binds a null client when UNLEASH_URL/TOKEN are unset — every
    // read must resolve to the caller's env default (the documented fallback).
    const svc = new FeatureFlagsService(null);
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, true)).toBe(true);
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, false)).toBe(false);
  });

  it("fails closed for the security flag: a throwing SDK read returns the fail-closed default, never opens the gate", () => {
    const throwing: UnleashLike = {
      isEnabled: () => {
        throw new Error("sdk boom");
      },
      on: () => undefined,
      destroy: () => undefined,
    };
    const svc = new FeatureFlagsService(throwing);
    // bot-protection is read with a fail-closed default of `enabled` (true). A
    // faulty SDK must not degrade to "gate open" — it returns the caller default.
    expect(svc.isEnabled(FLAG_BOT_PROTECTION, true)).toBe(true);
  });

  it("fires onChange listeners on a flag change and supports unsubscribe", () => {
    const { client, fire } = fakeUnleash({});
    const svc = new FeatureFlagsService(client);
    const cb = vi.fn();
    const unsub = svc.onChange(cb);
    fire();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    fire();
    expect(cb).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  it("onChange is a harmless no-op in env-only fallback mode (null client)", () => {
    const svc = new FeatureFlagsService(null);
    const unsub = svc.onChange(() => {
      throw new Error("must not fire");
    });
    expect(() => unsub()).not.toThrow();
  });

  it("fires onSynchronized listeners on the SDK's first sync and supports unsubscribe (#214 defect C)", () => {
    const { client, fireSync } = fakeUnleash({});
    const svc = new FeatureFlagsService(client);
    const cb = vi.fn();
    const unsub = svc.onSynchronized(cb);
    fireSync();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    fireSync();
    expect(cb).toHaveBeenCalledTimes(1); // no further calls after unsubscribe
  });

  it("onSynchronized is a harmless no-op in env-only fallback mode (null client)", () => {
    const svc = new FeatureFlagsService(null);
    const unsub = svc.onSynchronized(() => {
      throw new Error("must not fire");
    });
    expect(() => unsub()).not.toThrow();
  });

  it("destroys the SDK on module shutdown (stops the poll timer)", () => {
    const { client, destroyed } = fakeUnleash({});
    const svc = new FeatureFlagsService(client);
    svc.onModuleDestroy();
    expect(destroyed()).toBe(true);
  });

  it("module shutdown is a no-op when there is no live client", () => {
    const svc = new FeatureFlagsService(null);
    expect(() => svc.onModuleDestroy()).not.toThrow();
  });
});

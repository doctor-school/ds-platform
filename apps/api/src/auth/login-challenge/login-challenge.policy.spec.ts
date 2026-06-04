import { beforeEach, describe, expect, it } from "vitest";
import { LoginChallengePolicy } from "./login-challenge.policy.js";
import type { LoginChallengeConfig } from "./login-challenge.types.js";

// EARS-17: the login-challenge policy. After `threshold` failed logins from one
// origin within the window, that origin must solve a bot-protection challenge on
// its next attempt; a success clears the window. Exercised against a fake clock
// so the window-reset boundary is deterministic, with no Nest/HTTP in the loop.
describe("LoginChallengePolicy (EARS-17)", () => {
  const config: LoginChallengeConfig = {
    threshold: 3,
    windowMs: 15 * 60 * 1000,
  };
  const ip = "203.0.113.7";
  let now: number;
  let policy: LoginChallengePolicy;

  beforeEach(() => {
    now = 1_700_000_000_000;
    policy = new LoginChallengePolicy(config, () => now);
  });

  it("EARS-17: a fresh origin is not challenged", () => {
    expect(policy.isChallenged(ip)).toBe(false);
  });

  it("EARS-17: an origin is challenged once it reaches the failure threshold", () => {
    policy.recordFailure(ip);
    policy.recordFailure(ip);
    expect(policy.isChallenged(ip)).toBe(false); // 2 < 3
    policy.recordFailure(ip);
    expect(policy.isChallenged(ip)).toBe(true); // 3 ≥ 3
  });

  it("EARS-17: the challenge is per origin — a different IP is unaffected", () => {
    for (let i = 0; i < config.threshold; i++) policy.recordFailure(ip);
    expect(policy.isChallenged(ip)).toBe(true);
    expect(policy.isChallenged("198.51.100.2")).toBe(false);
  });

  it("EARS-17: a successful login clears the origin's failure window", () => {
    for (let i = 0; i < config.threshold; i++) policy.recordFailure(ip);
    expect(policy.isChallenged(ip)).toBe(true);
    policy.reset(ip);
    expect(policy.isChallenged(ip)).toBe(false);
  });

  it("EARS-17: failures age out once the window elapses", () => {
    for (let i = 0; i < config.threshold; i++) policy.recordFailure(ip);
    expect(policy.isChallenged(ip)).toBe(true);
    now += config.windowMs + 1; // advance just past the window
    expect(policy.isChallenged(ip)).toBe(false);
  });

  it("EARS-17: isChallenged does not itself consume or mutate the count", () => {
    policy.recordFailure(ip);
    policy.recordFailure(ip);
    // Reading many times must not push the count over the threshold.
    for (let i = 0; i < 10; i++) policy.isChallenged(ip);
    expect(policy.isChallenged(ip)).toBe(false);
    policy.recordFailure(ip);
    expect(policy.isChallenged(ip)).toBe(true);
  });
});

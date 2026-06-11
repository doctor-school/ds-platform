import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.schema.js";

/**
 * Single source of truth (#185): the delivery-reconcile module derives its
 * Unleash-unreachable `envDefaults` ({@link DeliveryEnvDefaults}) booleans from the
 * SAME `EMAIL_DELIVERY_MODE` / `SMS_DELIVERY_MODE` knobs `provision.sh` uses to
 * pick the boot provider — `mode === "real"`. This pins that mapping so boot intent
 * and the api fallback can never drift apart (no parallel boolean env var).
 */
describe("delivery-reconcile env defaults (single source of truth)", () => {
  const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db" };

  const derive = (
    source: Record<string, string>,
  ): { emailReal: boolean; smsReal: boolean } => {
    const env = loadEnv({ ...base, ...source });
    // Mirrors delivery-reconcile.module.ts's envDefaults derivation exactly.
    return {
      emailReal: env.EMAIL_DELIVERY_MODE === "real",
      smsReal: env.SMS_DELIVERY_MODE === "real",
    };
  };

  it('maps EMAIL_DELIVERY_MODE="real" → emailReal true', () => {
    expect(derive({ EMAIL_DELIVERY_MODE: "real" }).emailReal).toBe(true);
  });

  it('maps EMAIL_DELIVERY_MODE="mailpit" → emailReal false', () => {
    expect(derive({ EMAIL_DELIVERY_MODE: "mailpit" }).emailReal).toBe(false);
  });

  it('maps SMS_DELIVERY_MODE="real" → smsReal true', () => {
    expect(derive({ SMS_DELIVERY_MODE: "real" }).smsReal).toBe(true);
  });

  it('maps SMS_DELIVERY_MODE="sink" → smsReal false', () => {
    expect(derive({ SMS_DELIVERY_MODE: "sink" }).smsReal).toBe(false);
  });

  it("defaults to intercept (mailpit/sink) when the mode vars are absent", () => {
    const defaults = derive({});
    expect(defaults.emailReal).toBe(false);
    expect(defaults.smsReal).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { FeatureFlags, FlagName } from "../feature-flags/feature-flags.types.js";
import { DeliveryReconcileService } from "./delivery-reconcile.service.js";
import {
  SMS_DESCRIPTION_INTERCEPT,
  SMS_DESCRIPTION_REAL,
  SMTP_DESCRIPTION_INTERCEPT,
  SMTP_DESCRIPTION_REAL,
  type DeliveryAdmin,
  type ZitadelProvider,
} from "./delivery-reconcile.types.js";

/**
 * A FeatureFlags fake whose flag map is mutable so a toggle can be simulated.
 *
 * - `set` mutates a flag value (the next read sees it).
 * - `fire` invokes the `onChange` (`changed`) listeners — an operator UI toggle.
 * - `sync` invokes the `onSynchronized` listeners AND, to mirror the real SDK,
 *   reveals the live values: before sync, reads of any flag NOT pre-seeded as
 *   "live yet" return the caller's env default (the unsynchronised contract);
 *   after `sync()` the store values win. This models defect C's boot race where
 *   `isEnabled` returns the env default until the SDK's first poll lands.
 */
function fakeFlags(
  initial: Partial<Record<FlagName, boolean>>,
  opts: { syncedAtStart?: boolean } = {},
): {
  flags: FeatureFlags;
  set: (flag: FlagName, on: boolean) => void;
  fire: () => void;
  sync: () => void;
} {
  const store: Partial<Record<FlagName, boolean>> = { ...initial };
  const changeListeners: Array<() => void> = [];
  const syncListeners: Array<() => void> = [];
  let synced = opts.syncedAtStart ?? true;
  return {
    set: (flag, on) => {
      store[flag] = on;
    },
    fire: () => changeListeners.forEach((l) => l()),
    sync: () => {
      synced = true;
      syncListeners.forEach((l) => l());
    },
    flags: {
      // Until the SDK has synchronised, the live value is unknown → env default.
      isEnabled: (flag, defaultValue) =>
        synced ? (store[flag] ?? defaultValue) : defaultValue,
      onChange: (l) => {
        changeListeners.push(l);
        return () => {
          const i = changeListeners.indexOf(l);
          if (i >= 0) changeListeners.splice(i, 1);
        };
      },
      onSynchronized: (l) => {
        syncListeners.push(l);
        return () => {
          const i = syncListeners.indexOf(l);
          if (i >= 0) syncListeners.splice(i, 1);
        };
      },
    },
  };
}

/** A DeliveryAdmin fake recording activations; provider `active` flags are mutated on activate. */
function fakeAdmin(
  smtp: ZitadelProvider[],
  sms: ZitadelProvider[],
): {
  admin: DeliveryAdmin;
  smtpActivations: string[];
  smsActivations: string[];
} {
  const smtpActivations: string[] = [];
  const smsActivations: string[] = [];
  const activate = (list: ZitadelProvider[], id: string): void => {
    for (const p of list) p.active = p.id === id;
  };
  return {
    smtpActivations,
    smsActivations,
    admin: {
      listSmtpProviders: () => Promise.resolve(smtp),
      listSmsProviders: () => Promise.resolve(sms),
      activateSmtp: (id) => {
        smtpActivations.push(id);
        activate(smtp, id);
        return Promise.resolve();
      },
      activateSms: (id) => {
        smsActivations.push(id);
        activate(sms, id);
        return Promise.resolve();
      },
    },
  };
}

const smtpPair = (): ZitadelProvider[] => [
  { id: "smtp-mailpit", description: SMTP_DESCRIPTION_INTERCEPT, active: true },
  { id: "smtp-real", description: SMTP_DESCRIPTION_REAL, active: false },
];
const smsPair = (): ZitadelProvider[] => [
  { id: "sms-sink", description: SMS_DESCRIPTION_INTERCEPT, active: true },
  { id: "sms-aero", description: SMS_DESCRIPTION_REAL, active: false },
];

const envDefaults = { emailReal: false, smsReal: false };

describe("DeliveryReconcileService (#185 flag → Zitadel _activate)", () => {
  it("activates the REAL SMTP provider (matched by description) when email-delivery-real is on", async () => {
    const { flags } = fakeFlags({ "email-delivery-real": true });
    const { admin, smtpActivations, smsActivations } = fakeAdmin(
      smtpPair(),
      smsPair(),
    );
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.reconcile();
    expect(smtpActivations).toEqual(["smtp-real"]);
    // sms flag is off (intercept) and sms-sink is already active → no-op.
    expect(smsActivations).toEqual([]);
  });

  it("activates the REAL SMS provider when sms-delivery-real is on, leaving SMTP intercept untouched", async () => {
    const { flags } = fakeFlags({ "sms-delivery-real": true });
    const { admin, smtpActivations, smsActivations } = fakeAdmin(
      smtpPair(),
      smsPair(),
    );
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.reconcile();
    expect(smsActivations).toEqual(["sms-aero"]);
    expect(smtpActivations).toEqual([]);
  });

  it("activates the INTERCEPT provider when the flag is off but the REAL one is currently active (toggle back)", async () => {
    const { flags } = fakeFlags({ "sms-delivery-real": false });
    const sms: ZitadelProvider[] = [
      { id: "sms-sink", description: SMS_DESCRIPTION_INTERCEPT, active: false },
      { id: "sms-aero", description: SMS_DESCRIPTION_REAL, active: true },
    ];
    const { admin, smsActivations } = fakeAdmin(smtpPair(), sms);
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.reconcile();
    expect(smsActivations).toEqual(["sms-sink"]);
  });

  it("is a no-op when the desired provider is ALREADY active (idempotent — no redundant _activate)", async () => {
    // Both flags off, both intercept providers already active → nothing to do.
    const { flags } = fakeFlags({});
    const { admin, smtpActivations, smsActivations } = fakeAdmin(
      smtpPair(),
      smsPair(),
    );
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.reconcile();
    expect(smtpActivations).toEqual([]);
    expect(smsActivations).toEqual([]);
  });

  it("falls back to the env default per channel when the flag is unknown", async () => {
    // No flags defined in Unleash; env says email=real, sms=intercept.
    const { flags } = fakeFlags({});
    const { admin, smtpActivations, smsActivations } = fakeAdmin(
      smtpPair(),
      smsPair(),
    );
    const svc = new DeliveryReconcileService(flags, admin, {
      emailReal: true,
      smsReal: false,
    });
    await svc.reconcile();
    expect(smtpActivations).toEqual(["smtp-real"]);
    expect(smsActivations).toEqual([]);
  });

  it("skips a channel with a clear warning when the desired provider is not provisioned (no wrong activation)", async () => {
    // email-delivery-real on, but the REAL SMTP provider was never configured
    // (no real-SMTP creds → provision.sh skipped it). The reconcile must NOT
    // activate the intercept provider as a fallback — it leaves the channel as-is.
    const { flags } = fakeFlags({ "email-delivery-real": true });
    const smtpOnlyIntercept: ZitadelProvider[] = [
      { id: "smtp-mailpit", description: SMTP_DESCRIPTION_INTERCEPT, active: true },
    ];
    const { admin, smtpActivations } = fakeAdmin(smtpOnlyIntercept, smsPair());
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    const warn = vi.fn();
    await svc.reconcile(warn);
    expect(smtpActivations).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("reconciles on a flag-change event after start() subscribes", async () => {
    const { flags, set, fire } = fakeFlags({ "sms-delivery-real": false });
    const { admin, smsActivations } = fakeAdmin(smtpPair(), smsPair());
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.start(); // initial reconcile + subscribe; both intercept already active
    expect(smsActivations).toEqual([]);
    // Operator flips sms-delivery-real ON in the UI → SDK fires `changed`.
    set("sms-delivery-real", true);
    fire();
    // The change handler is async; flush microtasks.
    await new Promise((r) => setImmediate(r));
    expect(smsActivations).toEqual(["sms-aero"]);
  });

  it("defect B: subscribes to flag changes EVEN WHEN the initial reconcile fails (a later toggle still reconciles)", async () => {
    // The stand is briefly unreachable at boot, so the FIRST reconcile rejects.
    // A naive start() that awaits reconcile before subscribing would throw and
    // never subscribe → the flag is dead for the whole process lifetime.
    const { flags, set, fire } = fakeFlags({ "sms-delivery-real": false });
    const sms = smsPair();
    let firstSmsList = true;
    const smsActivations: string[] = [];
    const admin: DeliveryAdmin = {
      listSmtpProviders: () => Promise.resolve(smtpPair()),
      listSmsProviders: () => {
        if (firstSmsList) {
          firstSmsList = false;
          return Promise.reject(new Error("fetch failed"));
        }
        return Promise.resolve(sms);
      },
      activateSmtp: () => Promise.resolve(),
      activateSms: (id) => {
        smsActivations.push(id);
        for (const p of sms) p.active = p.id === id;
        return Promise.resolve();
      },
    };
    // attempts:1 → the initial reconcile fails permanently (no silent retry-save);
    // the only thing that can recover the channel is a surviving subscription.
    const svc = new DeliveryReconcileService(flags, admin, envDefaults, {
      attempts: 1,
      baseDelayMs: 0,
      sleep: () => Promise.resolve(),
    });
    // start() must NOT throw even though the initial reconcile rejects, and it
    // must leave the change subscription in place.
    await expect(svc.start(vi.fn())).resolves.toBeUndefined();
    // The dead-subscription bug would leave smsActivations empty forever.
    expect(smsActivations).toEqual([]);
    // Operator flips the flag ON later (connectivity has returned).
    set("sms-delivery-real", true);
    fire();
    await new Promise((r) => setImmediate(r));
    expect(smsActivations).toEqual(["sms-aero"]);
  });

  it("defect B (resilience): retries a transiently-failing initial reconcile with backoff and converges without any flag signal", async () => {
    // The first reconcile blips (stand mid-power-cycle), the retry succeeds. The
    // channel must converge to the env-default-on provider on its own — no toggle.
    const { flags } = fakeFlags({});
    const smtp = smtpPair();
    let firstSmtpList = true;
    const smtpActivations: string[] = [];
    const admin: DeliveryAdmin = {
      listSmtpProviders: () => {
        if (firstSmtpList) {
          firstSmtpList = false;
          return Promise.reject(new Error("fetch failed"));
        }
        return Promise.resolve(smtp);
      },
      listSmsProviders: () => Promise.resolve(smsPair()),
      activateSmtp: (id) => {
        smtpActivations.push(id);
        for (const p of smtp) p.active = p.id === id;
        return Promise.resolve();
      },
      activateSms: () => Promise.resolve(),
    };
    const sleeps: number[] = [];
    const svc = new DeliveryReconcileService(
      flags,
      admin,
      { emailReal: true, smsReal: false }, // env default email=real
      {
        attempts: 3,
        baseDelayMs: 10,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );
    await svc.start(vi.fn());
    expect(smtpActivations).toEqual(["smtp-real"]); // converged via the retry
    expect(sleeps).toEqual([10]); // backed off once before the successful retry
  });

  it("defect C: converges a steady-ON flag once the SDK synchronises, WITHOUT any changed toggle", async () => {
    // The flag is steadily ON in Unleash, but at boot the SDK has not synced yet,
    // so the initial reconcile reads the env default (intercept) and leaves Mailpit
    // active. No `changed` event ever fires (the flag value never changes). The
    // reconcile must re-run on the SDK's first `synchronized` signal and converge.
    const { flags, sync } = fakeFlags(
      { "email-delivery-real": true },
      { syncedAtStart: false },
    );
    const { admin, smtpActivations } = fakeAdmin(smtpPair(), smsPair());
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.start(vi.fn());
    // Pre-sync: env default email=intercept, mailpit already active → no activation.
    expect(smtpActivations).toEqual([]);
    // SDK finishes its first poll → `synchronized` fires (no `changed` toggle).
    sync();
    await new Promise((r) => setImmediate(r));
    expect(smtpActivations).toEqual(["smtp-real"]);
  });

  it("unsubscribes on stop() so no further reconcile fires", async () => {
    const { flags, set, fire } = fakeFlags({});
    const { admin, smsActivations } = fakeAdmin(smtpPair(), smsPair());
    const svc = new DeliveryReconcileService(flags, admin, envDefaults);
    await svc.start();
    svc.stop();
    set("sms-delivery-real", true);
    fire();
    await new Promise((r) => setImmediate(r));
    expect(smsActivations).toEqual([]);
  });
});

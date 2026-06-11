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

/** A FeatureFlags fake whose flag map is mutable so a toggle can be simulated. */
function fakeFlags(initial: Partial<Record<FlagName, boolean>>): {
  flags: FeatureFlags;
  set: (flag: FlagName, on: boolean) => void;
  fire: () => void;
} {
  const store: Partial<Record<FlagName, boolean>> = { ...initial };
  const listeners: Array<() => void> = [];
  return {
    set: (flag, on) => {
      store[flag] = on;
    },
    fire: () => listeners.forEach((l) => l()),
    flags: {
      isEnabled: (flag, defaultValue) => store[flag] ?? defaultValue,
      onChange: (l) => {
        listeners.push(l);
        return () => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
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

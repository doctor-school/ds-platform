import { describe, expect, it, vi } from "vitest";
import { ReconcileService } from "./reconcile.service.js";
import { type IdpClient } from "./idp/idp.types.js";
import type { UserMirrorService } from "./user-mirror.service.js";
import type {
  AuthAuditEvent,
  AuthAuditLog,
} from "./session/auth-audit.types.js";

/**
 * #119 + #753: `ReconcileService.sweep()` is the EARS-19 eventual-consistency
 * backstop, at full reconciliation depth (design §11):
 *
 * - **upsert + grant** every active human Zitadel user (skipping identifier-less
 *   machine/service accounts — the `users_email_or_phone` CHECK, #119);
 * - **soft-delete** the mirror row of a user Zitadel reports inactive, or one
 *   absent from the enumeration entirely (hard-deleted), and do not re-grant it;
 * - **reactivate** (clear the soft-delete) a user that reappears active;
 * - **audit** an `auth.reconcile.divergence` event when an upsert overwrites an
 *   identity field on an existing row (Zitadel-wins), naming only the changed
 *   field names.
 *
 * The DB-level behaviour (the actual `deactivated_at` write and the identity
 * diff) is proven end-to-end in `test/auth/reconcile-depth.e2e-spec.ts`; this
 * unit isolates the sweep's own orchestration over controllable fakes.
 */

function fakeIdp(
  users: Array<{
    sub: string;
    email?: string;
    phone?: string;
    emailVerified?: boolean;
    phoneVerified?: boolean;
    active?: boolean;
  }>,
): { idp: IdpClient; granted: string[] } {
  const granted: string[] = [];
  const idp = {
    listUsers: () =>
      Promise.resolve(
        users.map((u) => ({
          sub: u.sub,
          email: u.email,
          phone: u.phone,
          emailVerified: u.emailVerified ?? false,
          phoneVerified: u.phoneVerified ?? false,
          active: u.active ?? true,
        })),
      ),
    grantProjectRole: (sub: string) => {
      granted.push(sub);
      return Promise.resolve();
    },
  } as unknown as IdpClient;
  return { idp, granted };
}

/**
 * A stateful mirror double: an in-memory active-sub set stands in for the
 * `deactivated_at IS NULL` view. `upsert` (re)activates a sub and reports the
 * diverged identity fields the test preconfigured; `softDelete` deactivates an
 * active sub (idempotent, count-safe); `listActiveSubs` returns the live set.
 */
function fakeMirror(opts?: {
  activeSubs?: string[];
  diverge?: Record<string, string[]>;
}): {
  mirror: UserMirrorService;
  upserted: string[];
  softDeleted: string[];
  isActive: (sub: string) => boolean;
} {
  const upserted: string[] = [];
  const softDeleted: string[] = [];
  const active = new Set(opts?.activeSubs ?? []);
  const diverge = opts?.diverge ?? {};
  const mirror = {
    upsert: vi.fn((input: { zitadelSub: string }) => {
      upserted.push(input.zitadelSub);
      active.add(input.zitadelSub); // an upsert clears any prior soft-delete
      return Promise.resolve({
        changedIdentityFields: diverge[input.zitadelSub] ?? [],
      });
    }),
    softDelete: vi.fn((sub: string) => {
      const wasActive = active.delete(sub);
      if (wasActive) softDeleted.push(sub);
      return Promise.resolve(wasActive);
    }),
    listActiveSubs: vi.fn(() => Promise.resolve([...active])),
  } as unknown as UserMirrorService;
  return { mirror, upserted, softDeleted, isActive: (s) => active.has(s) };
}

function fakeAudit(): { audit: AuthAuditLog; events: AuthAuditEvent[] } {
  const events: AuthAuditEvent[] = [];
  const audit = {
    record: (e: AuthAuditEvent) => {
      events.push(e);
      return Promise.resolve();
    },
  } as unknown as AuthAuditLog;
  return { audit, events };
}

describe("ReconcileService.sweep — #119 EARS-19 backstop", () => {
  it("EARS-19: upserts + grants a human user (has email) and reports it reconciled", async () => {
    const { idp, granted } = fakeIdp([
      { sub: "human-1", email: "doc@ds.test", emailVerified: true },
    ]);
    const { mirror, upserted } = fakeMirror({ activeSubs: ["human-1"] });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();

    expect(upserted).toEqual(["human-1"]);
    expect(granted).toEqual(["human-1"]);
    expect(result.reconciled).toBe(1);
    expect(result.deactivated).toBe(0);
  });

  it("EARS-19: upserts a phone-only human user", async () => {
    const { idp } = fakeIdp([{ sub: "human-2", phone: "+79991234567" }]);
    const { mirror, upserted } = fakeMirror({ activeSubs: ["human-2"] });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();

    expect(upserted).toEqual(["human-2"]);
    expect(result.reconciled).toBe(1);
  });

  it("EARS-19: skips a machine/service account with neither email nor phone (no upsert, no grant, not counted)", async () => {
    const { idp, granted } = fakeIdp([
      { sub: "machine-svc" }, // no email, no phone — the BFF's own service user
      { sub: "human-3", email: "doc3@ds.test" },
    ]);
    const { mirror, upserted } = fakeMirror({ activeSubs: ["human-3"] });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();

    // The machine account is not a doctor_guest candidate (users_email_or_phone).
    expect(upserted).toEqual(["human-3"]);
    expect(granted).toEqual(["human-3"]);
    // Only the human user is counted as reconciled.
    expect(result.reconciled).toBe(1);
  });

  it("EARS-19: an empty Zitadel returns reconciled 0", async () => {
    const { idp } = fakeIdp([]);
    const { mirror } = fakeMirror();
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();
    expect(result.reconciled).toBe(0);
    expect(result.deactivated).toBe(0);
  });

  it("EARS-19: soft-deletes a mirror row for a user absent from the Zitadel enumeration", async () => {
    // Zitadel enumerates only `human-1`; the mirror still has an active `ghost`
    // row for a user hard-deleted at the IdP — the sweep must soft-delete it.
    const { idp } = fakeIdp([{ sub: "human-1", email: "doc@ds.test" }]);
    const { mirror, upserted, softDeleted, isActive } = fakeMirror({
      activeSubs: ["human-1", "ghost"],
    });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();

    expect(upserted).toEqual(["human-1"]);
    expect(softDeleted).toEqual(["ghost"]);
    expect(isActive("ghost")).toBe(false);
    expect(isActive("human-1")).toBe(true);
    expect(result.deactivated).toBe(1);
  });

  it("EARS-19: soft-deletes a mirror row for a user Zitadel reports inactive, and does not re-grant it", async () => {
    const { idp, granted } = fakeIdp([
      { sub: "gone", email: "gone@ds.test", active: false },
    ]);
    const { mirror, upserted, softDeleted } = fakeMirror({
      activeSubs: ["gone"],
    });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();

    // Deactivated → soft-deleted, skipped from upsert, and NOT re-granted.
    expect(softDeleted).toEqual(["gone"]);
    expect(upserted).toEqual([]);
    expect(granted).toEqual([]);
    expect(result.reconciled).toBe(0);
    expect(result.deactivated).toBe(1);
  });

  it("EARS-19: reactivation clears deactivated_at when a soft-deleted user reappears active", async () => {
    // `back` is currently soft-deleted (absent from the active set) but Zitadel
    // now reports it active again — the upsert must reactivate it.
    const { idp } = fakeIdp([{ sub: "back", email: "back@ds.test" }]);
    const { mirror, upserted, softDeleted, isActive } = fakeMirror({
      activeSubs: [],
    });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    await svc.sweep();

    expect(upserted).toEqual(["back"]);
    expect(softDeleted).toEqual([]);
    expect(isActive("back")).toBe(true); // reactivated (deactivated_at cleared)
  });

  it("EARS-19: emits auth.reconcile.divergence naming only the changed fields when an identity field diverges", async () => {
    const { idp } = fakeIdp([{ sub: "u1", email: "new@ds.test" }]);
    const { mirror } = fakeMirror({
      activeSubs: ["u1"],
      diverge: { u1: ["email", "phone"] },
    });
    const { audit, events } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    await svc.sweep();

    const divergences = events.filter((e) => e.type === "ReconcileDivergence");
    expect(divergences).toHaveLength(1);
    const [ev] = divergences;
    expect(ev).toEqual({
      type: "ReconcileDivergence",
      sub: "u1",
      fields: ["email", "phone"],
    });
    // PII-minimal: the event carries field NAMES only — no identifier values.
    expect(JSON.stringify(ev)).not.toContain("new@ds.test");
  });

  it("EARS-19: emits no divergence event on an unchanged pass or a brand-new row", async () => {
    // `new1` is a brand-new row (no existing → []); `same1` is an unchanged
    // pass (upsert reports no diverged fields). Neither emits a divergence event.
    const { idp } = fakeIdp([
      { sub: "new1", email: "new1@ds.test" },
      { sub: "same1", email: "same1@ds.test" },
    ]);
    const { mirror } = fakeMirror({ activeSubs: ["same1"], diverge: {} });
    const { audit, events } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    await svc.sweep();

    expect(events.filter((e) => e.type === "ReconcileDivergence")).toHaveLength(
      0,
    );
  });

  it("EARS-19: still skips identifier-less machine accounts without soft-deleting any human row", async () => {
    const { idp, granted } = fakeIdp([
      { sub: "machine-svc" }, // identifier-less — no mirror row exists for it
      { sub: "human", email: "human@ds.test" },
    ]);
    const { mirror, upserted, softDeleted } = fakeMirror({
      activeSubs: ["human"],
    });
    const { audit } = fakeAudit();
    const svc = new ReconcileService(idp, mirror, audit);

    const result = await svc.sweep();

    // The machine account is skipped (no upsert, no soft-delete); the human row
    // is enumerated so it is never mistaken for an absent row.
    expect(upserted).toEqual(["human"]);
    expect(granted).toEqual(["human"]);
    expect(softDeleted).toEqual([]);
    expect(result.reconciled).toBe(1);
    expect(result.deactivated).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { MirrorSelfHealService } from "./mirror-self-heal.service.js";
import { type IdpClient, type IdpUser } from "./idp/idp.types.js";
import type { UserMirrorService } from "./user-mirror.service.js";

/**
 * GH #709: `MirrorSelfHealService.ensureMirrored()` is the EARS-26 read-path
 * third mirror-sync layer (webhook primary, sweep backstop, this lazy). The e2e
 * (`test/auth/mirror-self-heal.e2e-spec.ts`) proves the vertical against a real
 * Postgres; this unit spec pins the edge semantics: present ⇒ untouched IdP,
 * unknown-at-IdP / identifier-less ⇒ no upsert, and any internal fault is
 * swallowed (fail-soft — a heal failure must never 500 a valid request).
 */

function fakeIdp(user: Omit<IdpUser, "active"> | null): {
  idp: IdpClient;
  granted: string[];
  getUserCalls: string[];
} {
  const granted: string[] = [];
  const getUserCalls: string[] = [];
  // The self-heal path does not branch on `active` (an authenticated subject is
  // active by construction); default it so the fixtures stay focused on the
  // identity fields the heal actually reads.
  const resolved: IdpUser | null = user ? { ...user, active: true } : null;
  const idp = {
    getUser: (sub: string) => {
      getUserCalls.push(sub);
      return Promise.resolve(resolved);
    },
    grantProjectRole: (sub: string) => {
      granted.push(sub);
      return Promise.resolve();
    },
  } as unknown as IdpClient;
  return { idp, granted, getUserCalls };
}

function fakeMirror(
  exists: boolean,
  role = "doctor_guest",
): {
  mirror: UserMirrorService;
  upserted: string[];
  roleWrites: [string, string][];
} {
  const upserted: string[] = [];
  const roleWrites: [string, string][] = [];
  const mirror = {
    findRoleBySub: vi.fn(() => Promise.resolve(exists ? role : undefined)),
    upsert: vi.fn((input: { zitadelSub: string }) => {
      upserted.push(input.zitadelSub);
      return Promise.resolve();
    }),
    setRole: vi.fn((sub: string, next: string) => {
      roleWrites.push([sub, next]);
      return Promise.resolve();
    }),
  } as unknown as UserMirrorService;
  return { mirror, upserted, roleWrites };
}

describe("003 EARS-26 MirrorSelfHealService — #709 read-path self-heal", () => {
  it("EARS-26: an absent mirror row is healed from the IdP — upsert with the IdP's identifiers + idempotent doctor_guest grant", async () => {
    const { idp, granted } = fakeIdp({
      sub: "orphan-1",
      email: "doc@ds.test",
      emailVerified: true,
      phoneVerified: false,
    });
    const { mirror, upserted } = fakeMirror(false);
    const svc = new MirrorSelfHealService(idp, mirror);

    await svc.ensureMirrored("orphan-1");

    expect(upserted).toEqual(["orphan-1"]);
    expect(granted).toEqual(["orphan-1"]);
    expect(mirror.upsert).toHaveBeenCalledWith({
      zitadelSub: "orphan-1",
      email: "doc@ds.test",
      phone: undefined,
      emailVerified: true,
      phoneVerified: false,
    });
  });

  it("EARS-26: a present mirror row is a no-op — the IdP is never consulted (hot path stays one indexed probe)", async () => {
    const { idp, getUserCalls, granted } = fakeIdp({
      sub: "present-1",
      email: "doc@ds.test",
      emailVerified: true,
      phoneVerified: false,
    });
    const { mirror, upserted } = fakeMirror(true);
    const svc = new MirrorSelfHealService(idp, mirror);

    await svc.ensureMirrored("present-1");

    expect(getUserCalls).toEqual([]);
    expect(upserted).toEqual([]);
    expect(granted).toEqual([]);
  });

  it("EARS-26: a sub the IdP no longer knows heals nothing — the request proceeds to the fail-closed 401", async () => {
    const { idp, granted } = fakeIdp(null);
    const { mirror, upserted } = fakeMirror(false);
    const svc = new MirrorSelfHealService(idp, mirror);

    await svc.ensureMirrored("gone-1");

    expect(upserted).toEqual([]);
    expect(granted).toEqual([]);
  });

  it("EARS-26: an identifier-less IdP account (machine/service) is skipped — not a doctor_guest mirror candidate (users_email_or_phone)", async () => {
    const { idp, granted } = fakeIdp({
      sub: "machine-svc",
      emailVerified: false,
      phoneVerified: false,
    });
    const { mirror, upserted } = fakeMirror(false);
    const svc = new MirrorSelfHealService(idp, mirror);

    await svc.ensureMirrored("machine-svc");

    expect(upserted).toEqual([]);
    expect(granted).toEqual([]);
  });

  it("EARS-26: a heal-path fault is swallowed (fail-soft) — ensureMirrored never throws into the request", async () => {
    const { idp } = fakeIdp({
      sub: "orphan-2",
      email: "doc2@ds.test",
      emailVerified: true,
      phoneVerified: false,
    });
    const mirror = {
      findRoleBySub: vi.fn(() => Promise.resolve(undefined)),
      upsert: vi.fn(() => Promise.reject(new Error("db down"))),
    } as unknown as UserMirrorService;
    const svc = new MirrorSelfHealService(idp, mirror);

    await expect(svc.ensureMirrored("orphan-2")).resolves.toBeUndefined();
  });

  describe("#2456 staff marker — users.role mirrors the session's project-roles claim", () => {
    const idpUser = {
      sub: "staff-1",
      email: "staff@ds.test",
      emailVerified: true,
      phoneVerified: false,
    };

    it("#2456: a visitor row whose session carries platform_admin is marked staff — the mirror records the staff role", async () => {
      const { idp } = fakeIdp(idpUser);
      const { mirror, roleWrites } = fakeMirror(true, "doctor_guest");
      const svc = new MirrorSelfHealService(idp, mirror);

      await svc.ensureMirrored("staff-1", ["doctor_guest", "platform_admin"]);

      expect(roleWrites).toEqual([["staff-1", "platform_admin"]]);
    });

    it("#2456: a staff row whose session no longer carries a staff role is returned to the visitor role", async () => {
      const { idp } = fakeIdp(idpUser);
      const { mirror, roleWrites } = fakeMirror(true, "platform_admin");
      const svc = new MirrorSelfHealService(idp, mirror);

      await svc.ensureMirrored("staff-1", ["doctor_guest"]);

      expect(roleWrites).toEqual([["staff-1", "doctor_guest"]]);
    });

    it("#2456: a row already matching the claim is not written (hot path stays one read)", async () => {
      const { idp, getUserCalls } = fakeIdp(idpUser);
      const { mirror, roleWrites } = fakeMirror(true, "event-registrar");
      const svc = new MirrorSelfHealService(idp, mirror);

      await svc.ensureMirrored("staff-1", ["event-registrar", "doctor_guest"]);

      expect(roleWrites).toEqual([]);
      expect(getUserCalls).toEqual([]);
    });

    it("#2456: a freshly healed staff row is marked staff in the same pass", async () => {
      const { idp } = fakeIdp(idpUser);
      const { mirror, upserted, roleWrites } = fakeMirror(false);
      const svc = new MirrorSelfHealService(idp, mirror);

      await svc.ensureMirrored("staff-1", ["platform_admin"]);

      expect(upserted).toEqual(["staff-1"]);
      expect(roleWrites).toEqual([["staff-1", "platform_admin"]]);
    });
  });
});

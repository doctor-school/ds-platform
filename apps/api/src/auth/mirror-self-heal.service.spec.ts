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

function fakeIdp(user: IdpUser | null): {
  idp: IdpClient;
  granted: string[];
  getUserCalls: string[];
} {
  const granted: string[] = [];
  const getUserCalls: string[] = [];
  const idp = {
    getUser: (sub: string) => {
      getUserCalls.push(sub);
      return Promise.resolve(user);
    },
    grantProjectRole: (sub: string) => {
      granted.push(sub);
      return Promise.resolve();
    },
  } as unknown as IdpClient;
  return { idp, granted, getUserCalls };
}

function fakeMirror(exists: boolean): {
  mirror: UserMirrorService;
  upserted: string[];
} {
  const upserted: string[] = [];
  const mirror = {
    existsBySub: vi.fn(() => Promise.resolve(exists)),
    upsert: vi.fn((input: { zitadelSub: string }) => {
      upserted.push(input.zitadelSub);
      return Promise.resolve();
    }),
  } as unknown as UserMirrorService;
  return { mirror, upserted };
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
      existsBySub: vi.fn(() => Promise.resolve(false)),
      upsert: vi.fn(() => Promise.reject(new Error("db down"))),
    } as unknown as UserMirrorService;
    const svc = new MirrorSelfHealService(idp, mirror);

    await expect(svc.ensureMirrored("orphan-2")).resolves.toBeUndefined();
  });
});

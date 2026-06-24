import { describe, expect, it, vi } from "vitest";
import { ReconcileService } from "./reconcile.service.js";
import { type IdpClient } from "./idp/idp.types.js";
import type { UserMirrorService } from "./user-mirror.service.js";

/**
 * #119: `ReconcileService.sweep()` is the EARS-19 eventual-consistency backstop.
 * Live-running it for the first time (the manual trigger / scheduler this issue
 * builds) surfaced that `idp.listUsers()` enumerates EVERY Zitadel user —
 * including machine / service accounts that have neither email nor phone (e.g.
 * the BFF's own service user). The `users` mirror models human doctor identities
 * (design §5) and the DB enforces a `users_email_or_phone` CHECK constraint, so a
 * machine account is NOT a `doctor_guest` mirror candidate and must be skipped —
 * otherwise the whole sweep fails closed on the first identifier-less row.
 */

function fakeIdp(
  users: Array<{
    sub: string;
    email?: string;
    phone?: string;
    emailVerified?: boolean;
    phoneVerified?: boolean;
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
        })),
      ),
    grantProjectRole: (sub: string) => {
      granted.push(sub);
      return Promise.resolve();
    },
  } as unknown as IdpClient;
  return { idp, granted };
}

function fakeMirror(): { mirror: UserMirrorService; upserted: string[] } {
  const upserted: string[] = [];
  const mirror = {
    upsert: vi.fn((input: { zitadelSub: string }) => {
      upserted.push(input.zitadelSub);
      return Promise.resolve();
    }),
  } as unknown as UserMirrorService;
  return { mirror, upserted };
}

describe("ReconcileService.sweep — #119 EARS-19 backstop", () => {
  it("upserts + grants a human user (has email) and reports it reconciled", async () => {
    const { idp, granted } = fakeIdp([
      { sub: "human-1", email: "doc@ds.test", emailVerified: true },
    ]);
    const { mirror, upserted } = fakeMirror();
    const svc = new ReconcileService(idp, mirror);

    const result = await svc.sweep();

    expect(upserted).toEqual(["human-1"]);
    expect(granted).toEqual(["human-1"]);
    expect(result.reconciled).toBe(1);
  });

  it("upserts a phone-only human user", async () => {
    const { idp } = fakeIdp([{ sub: "human-2", phone: "+79991234567" }]);
    const { mirror, upserted } = fakeMirror();
    const svc = new ReconcileService(idp, mirror);

    const result = await svc.sweep();

    expect(upserted).toEqual(["human-2"]);
    expect(result.reconciled).toBe(1);
  });

  it("skips a machine/service account with neither email nor phone (no upsert, no grant, not counted)", async () => {
    const { idp, granted } = fakeIdp([
      { sub: "machine-svc" }, // no email, no phone — the BFF's own service user
      { sub: "human-3", email: "doc3@ds.test" },
    ]);
    const { mirror, upserted } = fakeMirror();
    const svc = new ReconcileService(idp, mirror);

    const result = await svc.sweep();

    // The machine account is not a doctor_guest candidate (users_email_or_phone).
    expect(upserted).toEqual(["human-3"]);
    expect(granted).toEqual(["human-3"]);
    // Only the human user is counted as reconciled.
    expect(result.reconciled).toBe(1);
  });

  it("an empty Zitadel returns reconciled 0", async () => {
    const { idp } = fakeIdp([]);
    const { mirror } = fakeMirror();
    const svc = new ReconcileService(idp, mirror);

    expect((await svc.sweep()).reconciled).toBe(0);
  });
});

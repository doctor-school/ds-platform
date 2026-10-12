import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import { UserMirrorService } from "../../src/auth/user-mirror.service.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

// 003 EARS-48/51 (#2449): `users.phone` is UNIQUE, and a phone is an account
// phone only while the mirror holds it. When the IdP reports a number verified
// on a user while another account already holds it confirmed (the loser of a
// confirmation race whose IdP clean-up did not land), the mirror sync — the
// webhook, the reconcile sweep and the self-heal all share this upsert — treats
// that number as not confirmed for the second user: it clears the phone and
// never throws, so one conflicting number cannot stall the sweep.
describe.skipIf(!process.env.DATABASE_URL)(
  "003 EARS-48/51 mirror sync on a phone UNIQUE conflict (e2e)",
  () => {
    let handle: DrizzleHandle;
    let mirror: UserMirrorService;
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const holder = `mirror-conflict-holder-${tag}`;
    const loser = `mirror-conflict-loser-${tag}`;
    // A +999 synthetic number (EARS-33 tag), unique per run.
    const phone = `+999${String(Date.now()).slice(-8)}`;

    beforeAll(() => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 2 });
      mirror = new UserMirrorService(handle.db);
    });

    afterAll(async () => {
      await deleteUserFixture(handle.pool, "zitadel_sub", holder);
      await deleteUserFixture(handle.pool, "zitadel_sub", loser);
      await handle.pool.end();
    });

    it("EARS-51: a verified IdP phone already confirmed on another account is mirrored as not confirmed — cleared, never thrown", async () => {
      await mirror.upsert({
        zitadelSub: holder,
        email: `${holder}@ds.test`,
        phone,
        phoneVerified: true,
      });
      // The loser first holds a confirmed number of its own, which the sync
      // must clear rather than keep.
      const own = `+999${String(Date.now() + 1).slice(-8)}`;
      await mirror.upsert({
        zitadelSub: loser,
        email: `${loser}@ds.test`,
        phone: own,
        phoneVerified: true,
      });

      await expect(
        mirror.upsert({
          zitadelSub: loser,
          email: `${loser}@ds.test`,
          phone,
          phoneVerified: true,
        }),
      ).resolves.toBeDefined();

      const { rows } = await handle.pool.query<{
        zitadel_sub: string;
        phone: string | null;
        phone_verified: boolean;
      }>(
        "SELECT zitadel_sub, phone, phone_verified FROM users WHERE zitadel_sub = ANY($1)",
        [[holder, loser]],
      );
      const bySub = new Map(rows.map((r) => [r.zitadel_sub, r]));
      expect(bySub.get(holder)).toMatchObject({ phone, phone_verified: true });
      expect(bySub.get(loser)).toMatchObject({
        phone: null,
        phone_verified: false,
      });
    });

    it("EARS-51: a brand-new mirror row whose verified phone is taken is created without it", async () => {
      const fresh = `${loser}-new`;
      try {
        await expect(
          mirror.upsert({
            zitadelSub: fresh,
            email: `${fresh}@ds.test`,
            phone,
            phoneVerified: true,
          }),
        ).resolves.toBeDefined();
        const { rows } = await handle.pool.query<{
          phone: string | null;
          phone_verified: boolean;
        }>("SELECT phone, phone_verified FROM users WHERE zitadel_sub = $1", [
          fresh,
        ]);
        expect(rows[0]).toMatchObject({ phone: null, phone_verified: false });
      } finally {
        await deleteUserFixture(handle.pool, "zitadel_sub", fresh);
      }
    });
  },
);

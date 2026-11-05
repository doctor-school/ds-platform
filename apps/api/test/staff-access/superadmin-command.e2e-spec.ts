import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplicationContext } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";
import { runSuperadminCommand } from "../../src/staff-access/superadmin-cli.js";
import {
  SuperadminRefusal,
  type SuperadminCommand,
} from "../../src/staff-access/superadmin-command.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

interface LedgerRow {
  event_type: string;
  metadata: Record<string, unknown>;
}

/**
 * 049 V-5 — the superadmin operator command against the IdP fake and the real
 * Postgres ledger: grant adds both roles keeping `doctor_guest`, removal drops
 * `superadmin` only and ends admin access, every refusal changes nothing.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "049 superadmin operator command (e2e)",
  () => {
    let app: INestApplicationContext;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const createdSubs: string[] = [];

    /** An existing IdP account holding `roles`; email verified unless told otherwise. */
    function account(
      roles: string[] = ["doctor_guest"],
      verified = true,
    ): { sub: string; email: string } {
      const sub = `s049-${randomUUID()}`;
      const email = `${sub}@ds.test`;
      createdSubs.push(sub);
      fake.seedUser({ sub, email });
      if (verified) fake.setIdentity(sub, { emailVerified: true });
      if (roles.length > 0) void fake.grantProjectRole(sub, roles);
      return { sub, email };
    }

    async function dbNow(): Promise<Date> {
      const { rows } = await pool.query<{ t: Date }>("SELECT now() AS t");
      return rows[0]!.t;
    }

    async function roleRows(sub: string, since: Date): Promise<LedgerRow[]> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT event_type, metadata FROM audit_ledger
          WHERE subject_id = $1 AND created_at >= $2 AND event_type LIKE 'auth.role.%'
          ORDER BY created_at ASC, event_type ASC`,
        [sub, since],
      );
      return rows;
    }

    function run(command: SuperadminCommand) {
      return runSuperadminCommand(app, command);
    }

    function idpWriteSpies() {
      return [
        vi.spyOn(fake, "createUser"),
        vi.spyOn(fake, "grantProjectRole"),
        vi.spyOn(fake, "updateProjectGrantRoles"),
        vi.spyOn(fake, "removeProjectGrant"),
        vi.spyOn(fake, "setUserPassword"),
      ];
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = await moduleRef.init();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      fake = app.get<FakeIdpClient>(IDP_CLIENT);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      for (const sub of createdSubs.splice(0))
        await deleteUserFixture(pool, "zitadel_sub", sub);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("049 EARS-6: grant adds superadmin and platform_admin keeping doctor_guest, two grant rows with the operator; a repeat writes none", async () => {
      const operator = account();
      const target = account();
      const since = await dbNow();

      const result = await run({
        verb: "grant",
        email: target.email,
        byAdmin: operator.sub,
      });

      expect(result.changed).toEqual(["platform_admin", "superadmin"]);
      expect(fake.grantedRoles(target.sub).sort()).toEqual(
        ["doctor_guest", "platform_admin", "superadmin"].sort(),
      );
      const rows = await roleRows(target.sub, since);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.event_type)).toEqual([
        "auth.role.granted",
        "auth.role.granted",
      ]);
      expect(rows.map((r) => r.metadata.role).sort()).toEqual([
        "platform_admin",
        "superadmin",
      ]);
      for (const row of rows) {
        expect(row.metadata).toMatchObject({
          by_admin: operator.sub,
          tier: "admin",
        });
      }
      const { rows: mirror } = await pool.query<{ role: string }>(
        "SELECT role FROM users WHERE zitadel_sub = $1",
        [target.sub],
      );
      expect(mirror[0]?.role).toBe("superadmin");

      const writes = idpWriteSpies();
      const repeat = await run({
        verb: "grant",
        email: target.email,
        byAdmin: operator.sub,
      });
      expect(repeat.changed).toEqual([]);
      for (const spy of writes) expect(spy).not.toHaveBeenCalled();
      expect(await roleRows(target.sub, since)).toHaveLength(2);
    });

    it("049 EARS-6: grant to a platform administrator adds only superadmin and writes one row", async () => {
      const operator = account();
      const target = account(["doctor_guest", "platform_admin"]);
      const since = await dbNow();

      const result = await run({
        verb: "grant",
        email: target.email,
        byAdmin: operator.sub,
      });

      expect(result.changed).toEqual(["superadmin"]);
      const rows = await roleRows(target.sub, since);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.metadata).toMatchObject({
        role: "superadmin",
        by_admin: operator.sub,
      });
    });

    it("049 EARS-6: remove drops superadmin only, ends every admin session and pending sign-in, writes auth.role.revoked", async () => {
      const operator = account();
      account(["doctor_guest", "platform_admin", "superadmin"]); // another holder
      const target = account();
      await run({ verb: "grant", email: target.email, byAdmin: operator.sub });
      const endAll = vi.spyOn(
        app.get(AdminSessionService),
        "endAllAdminAccess",
      );
      const since = await dbNow();

      const result = await run({
        verb: "remove",
        email: target.email,
        byAdmin: operator.sub,
      });

      expect(result.changed).toEqual(["superadmin"]);
      expect(fake.grantedRoles(target.sub).sort()).toEqual([
        "doctor_guest",
        "platform_admin",
      ]);
      expect(endAll).toHaveBeenCalledWith(target.sub);
      const rows = await roleRows(target.sub, since);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        event_type: "auth.role.revoked",
        metadata: { role: "superadmin", by_admin: operator.sub },
      });
      const { rows: mirror } = await pool.query<{ role: string }>(
        "SELECT role FROM users WHERE zitadel_sub = $1",
        [target.sub],
      );
      expect(mirror[0]?.role).toBe("platform_admin");

      await expect(
        run({ verb: "remove", email: target.email, byAdmin: operator.sub }),
      ).rejects.toMatchObject({ code: "NOT_A_SUPERADMIN" });
      expect(await roleRows(target.sub, since)).toHaveLength(1);
    });

    it("049 EARS-6: the last holder of superadmin is refused with nothing changed", async () => {
      const operator = account();
      const target = account();
      await run({ verb: "grant", email: target.email, byAdmin: operator.sub });
      // Make it the only holder in this IdP (earlier tests left others).
      const holders = await fake.listProjectGrantsWithRoles(["superadmin"]);
      for (const h of holders) {
        if (h.sub !== target.sub)
          await fake.revokeProjectRole(h.sub, "superadmin");
      }
      const writes = idpWriteSpies();
      const endAll = vi.spyOn(
        app.get(AdminSessionService),
        "endAllAdminAccess",
      );
      const since = await dbNow();

      await expect(
        run({ verb: "remove", email: target.email, byAdmin: operator.sub }),
      ).rejects.toMatchObject({ code: "LAST_SUPERADMIN" });

      expect(fake.grantedRoles(target.sub)).toContain("superadmin");
      for (const spy of writes) expect(spy).not.toHaveBeenCalled();
      expect(endAll).not.toHaveBeenCalled();
      expect(await roleRows(target.sub, since)).toHaveLength(0);
    });

    it.each([
      ["an unknown email", "EMAIL_UNKNOWN"],
      ["an unverified email", "EMAIL_UNVERIFIED"],
      ["an email two accounts hold", "EMAIL_AMBIGUOUS"],
      ["a --by-admin subject that resolves to no account", "BY_ADMIN_UNKNOWN"],
      ["an empty --by-admin subject", "BY_ADMIN_UNKNOWN"],
    ])(
      "049 EARS-6: %s is refused for grant and remove with nothing changed",
      async (_case, code) => {
        const operator = account();
        let email: string;
        let byAdmin = operator.sub;
        let watched: string | undefined;
        if (code === "EMAIL_UNKNOWN") {
          email = `s049-nobody-${randomUUID()}@ds.test`;
        } else if (code === "EMAIL_UNVERIFIED") {
          const t = account(["doctor_guest"], false);
          email = t.email;
          watched = t.sub;
        } else if (code === "EMAIL_AMBIGUOUS") {
          const t = account();
          const twin = `s049-${randomUUID()}`;
          createdSubs.push(twin);
          fake.seedUser({ sub: twin, email: t.email });
          email = t.email;
          watched = t.sub;
        } else {
          const t = account();
          email = t.email;
          watched = t.sub;
          byAdmin = _case.includes("empty")
            ? " "
            : `s049-ghost-${randomUUID()}`;
        }
        const writes = idpWriteSpies();
        const endAll = vi.spyOn(
          app.get(AdminSessionService),
          "endAllAdminAccess",
        );
        const since = await dbNow();

        for (const verb of ["grant", "remove"] as const) {
          const outcome = run({ verb, email, byAdmin });
          await expect(outcome).rejects.toBeInstanceOf(SuperadminRefusal);
          await expect(outcome).rejects.toMatchObject({ code });
        }

        for (const spy of writes) expect(spy).not.toHaveBeenCalled();
        expect(endAll).not.toHaveBeenCalled();
        if (watched) {
          expect(fake.grantedRoles(watched)).toEqual(["doctor_guest"]);
          expect(await roleRows(watched, since)).toHaveLength(0);
        }
      },
    );
  },
);

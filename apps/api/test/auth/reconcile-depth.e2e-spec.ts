import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { ReconcileService } from "../../src/auth/reconcile.service.js";

/**
 * #753 EARS-19 reconcile depth (design §11): the sweep soft-deletes the mirror
 * row of a user Zitadel reports inactive OR absent (hard-deleted), reactivates a
 * user that reappears active, and audits an `auth.reconcile.divergence` event
 * (field NAMES only) when it overwrites a diverged identity field (Zitadel-wins).
 *
 * Exercised end-to-end against real Postgres with the in-memory `FakeIdpClient`
 * standing in for Zitadel — the same fake/real split the F1 suites use. Each
 * test uses per-run-unique subs and cleans up its `users` rows (the append-only
 * `audit_ledger` rows are scoped by the unique subject and left in place).
 */
describe.skipIf(!process.env.DATABASE_URL)("Reconcile depth (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let fake: FakeIdpClient;
  let reconcile: ReconcileService;
  const runId = Date.now();
  const subs: string[] = [];

  beforeAll(async () => {
    fake = new FakeIdpClient();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IDP_CLIENT)
      .useValue(fake)
      .overrideProvider(RATE_LIMIT_THRESHOLDS)
      .useValue(RELAXED_RATE_LIMIT)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = app.get<pg.Pool>(DRIZZLE_POOL);
    reconcile = app.get(ReconcileService);
  });

  afterEach(async () => {
    for (const sub of subs.splice(0)) {
      fake.removeUser(sub); // reset fake state so later sweeps ignore it
      await pool.query("DELETE FROM users WHERE zitadel_sub = $1", [sub]);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function deactivatedAt(sub: string): Promise<Date | null> {
    const { rows } = await pool.query(
      "SELECT deactivated_at FROM users WHERE zitadel_sub = $1",
      [sub],
    );
    expect(rows).toHaveLength(1);
    return rows[0].deactivated_at as Date | null;
  }

  it("EARS-19: soft-deletes a mirror row for a user Zitadel reports inactive, and does not re-grant it", async () => {
    const sub = `depth-inactive-${runId}`;
    subs.push(sub);
    fake.seedUser({ sub, email: `${sub}@ds.test` });

    await reconcile.sweep();
    expect(await deactivatedAt(sub)).toBeNull(); // active after first sweep

    fake.setActive(sub, false);
    const { deactivated } = await reconcile.sweep();

    expect(await deactivatedAt(sub)).toBeInstanceOf(Date);
    expect(deactivated).toBeGreaterThanOrEqual(1);
  });

  it("EARS-19: soft-deletes a mirror row for a user absent from the Zitadel enumeration", async () => {
    const sub = `depth-deleted-${runId}`;
    // A `keeper` stays present so the enumeration is non-empty after the target
    // is removed — the safety guard deliberately skips the absent-row pass on an
    // EMPTY enumeration (an outage must not read as "everyone was deleted").
    const keeper = `depth-keeper-${runId}`;
    subs.push(sub, keeper);
    fake.seedUser({ sub, email: `${sub}@ds.test` });
    fake.seedUser({ sub: keeper, email: `${keeper}@ds.test` });

    await reconcile.sweep();
    expect(await deactivatedAt(sub)).toBeNull();

    fake.removeUser(sub); // hard-deleted at the IdP — drops out of listUsers()
    await reconcile.sweep();

    expect(await deactivatedAt(sub)).toBeInstanceOf(Date);
    expect(await deactivatedAt(keeper)).toBeNull(); // present user untouched
  });

  it("EARS-19: reactivation clears deactivated_at when a soft-deleted user reappears active", async () => {
    const sub = `depth-reactivate-${runId}`;
    subs.push(sub);
    fake.seedUser({ sub, email: `${sub}@ds.test` });

    await reconcile.sweep();
    fake.setActive(sub, false);
    await reconcile.sweep();
    expect(await deactivatedAt(sub)).toBeInstanceOf(Date); // soft-deleted

    fake.setActive(sub, true);
    await reconcile.sweep();

    expect(await deactivatedAt(sub)).toBeNull(); // reactivated
  });

  it("EARS-19: emits auth.reconcile.divergence naming only the changed fields when an identity field diverges (and none on an unchanged pass)", async () => {
    const sub = `depth-diverge-${runId}`;
    subs.push(sub);
    fake.seedUser({ sub, email: `old-${sub}@ds.test` });

    await reconcile.sweep(); // brand-new row — no divergence event
    expect(await divergenceCount(sub)).toBe(0);

    fake.setIdentity(sub, { email: `new-${sub}@ds.test` });
    await reconcile.sweep(); // Zitadel-wins overwrite of email → one event

    const { rows } = await pool.query(
      "SELECT event_type, metadata FROM audit_ledger WHERE subject_id = $1 AND event_type = 'auth.reconcile.divergence'",
      [sub],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.fields).toEqual(["email"]);
    // PII-minimal: the ledger row carries field NAMES only — no raw identifier.
    expect(JSON.stringify(rows[0].metadata)).not.toContain("@ds.test");

    // An unchanged re-sweep emits no further divergence row.
    await reconcile.sweep();
    expect(await divergenceCount(sub)).toBe(1);
  });

  async function divergenceCount(sub: string): Promise<number> {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM audit_ledger WHERE subject_id = $1 AND event_type = 'auth.reconcile.divergence'",
      [sub],
    );
    return rows[0].n as number;
  }
});

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

// Mirror sync (EARS-19): the Zitadel Action webhook upserts a doctor_guest
// mirror row and the reconciliation sweep closes a webhook-miss divergence. The
// webhook authenticates with a shared secret and fails closed without it.
const WEBHOOK_SECRET = "test-webhook-secret";

describe.skipIf(!process.env.DATABASE_URL)("Mirror sync (e2e)", () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let fake: FakeIdpClient;
  const runId = Date.now();
  const subs: string[] = [];

  beforeAll(async () => {
    process.env.IDP_WEBHOOK_SECRET = WEBHOOK_SECRET;
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
  });

  afterEach(async () => {
    for (const sub of subs.splice(0))
      await pool.query("DELETE FROM users WHERE zitadel_sub = $1", [sub]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("EARS-19: when Zitadel emits a user webhook, the system shall upsert a doctor_guest mirror row", async () => {
    const sub = `wh-${runId}-1`;
    subs.push(sub);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/zitadel/webhook",
      headers: { "x-zitadel-webhook-secret": WEBHOOK_SECRET },
      payload: { zitadelSub: sub, email: `wh1-${runId}@ds.test` },
    });

    expect(res.statusCode).toBe(200);
    const { rows } = await pool.query(
      "SELECT role FROM users WHERE zitadel_sub = $1",
      [sub],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("doctor_guest");
  });

  it("EARS-19: when the webhook secret is missing or wrong, the system shall reject it and write no mirror row", async () => {
    const sub = `wh-${runId}-2`;
    subs.push(sub);
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/zitadel/webhook",
      headers: { "x-zitadel-webhook-secret": "wrong" },
      payload: { zitadelSub: sub, email: `wh2-${runId}@ds.test` },
    });

    expect(res.statusCode).toBe(401);
    const { rows } = await pool.query(
      "SELECT 1 FROM users WHERE zitadel_sub = $1",
      [sub],
    );
    expect(rows).toHaveLength(0);
  });

  it("EARS-19: when the reconciliation sweep runs, the system shall create the missing mirror row and ensure the doctor_guest grant", async () => {
    const sub = `recon-${runId}`;
    subs.push(sub);
    // A Zitadel user whose create webhook was never delivered — no mirror row.
    fake.seedUser({ sub, email: `recon-${runId}@ds.test` });

    const before = await pool.query(
      "SELECT 1 FROM users WHERE zitadel_sub = $1",
      [sub],
    );
    expect(before.rows).toHaveLength(0);

    const reconcile = app.get(ReconcileService);
    await reconcile.sweep();

    const { rows } = await pool.query(
      "SELECT role FROM users WHERE zitadel_sub = $1",
      [sub],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("doctor_guest");
  });
});

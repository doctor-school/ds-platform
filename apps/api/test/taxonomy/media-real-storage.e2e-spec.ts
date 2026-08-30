import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import type pg from "pg";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import {
  OBJECT_STORAGE,
  S3ObjectStorage,
  type ObjectStorage,
} from "../../src/storage/index.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import { registerUniqueFakeUserFixture } from "../setup/fixture-registration.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

function isIssue1609Database(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.replace(/^\//, "") === "ds_dev_1609";
  } catch {
    return false;
  }
}

const hasLiveDependencies = Boolean(
  isIssue1609Database(process.env.DATABASE_URL) &&
  process.env.IDP_ISSUER &&
  process.env.S3_ENDPOINT &&
  process.env.S3_ACCESS_KEY &&
  process.env.S3_SECRET_KEY,
);

// 012 EARS-21 (#1609) — storage-refusal acceptance against the REAL S3
// adapter and a test-owned private bucket. The refusal path deliberately uses
// invalid credentials against that bucket, while the recovery request uses a
// fresh idempotency key and the valid credentials supplied by the environment.
// No shared uploads bucket is read or changed, and the suite refuses to run on
// any database except the branch DB created for Issue #1609.
describe.skipIf(!hasLiveDependencies)(
  "012 EARS-21 reversible taxonomy media (real object-store e2e)",
  () => {
    const endpoint = (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, "");
    const region = process.env.S3_REGION ?? "us-east-1";
    const accessKey = process.env.S3_ACCESS_KEY ?? "";
    const secretKey = process.env.S3_SECRET_KEY ?? "";
    const bucket = `ds-e2e-1609-${randomUUID().slice(0, 8)}`;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
    const validConfig = {
      endpoint,
      region,
      bucket,
      accessKey,
      secretKey,
      forcePathStyle,
    };
    const validStorage = new S3ObjectStorage(validConfig);
    const refusingStorage = new S3ObjectStorage({
      ...validConfig,
      accessKey: `invalid-${randomUUID()}`,
      secretKey: `invalid-${randomUUID()}`,
    });
    const bucketClient = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });

    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let adminSid: string;
    let refusePuts = false;
    const fakeIdp = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = {
      "user-agent": "AdminTest/1.0",
      "accept-language": "en-US",
    };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdRows: { table: string; id: string }[] = [];
    const usedKeys: string[] = [];

    const routedStorage: ObjectStorage = {
      put: (input) => (refusePuts ? refusingStorage : validStorage).put(input),
      urlFor: (key) => validStorage.urlFor(key),
      exists: (key) => validStorage.exists(key),
      getBytes: (key) => validStorage.getBytes(key),
      delete: (key) => validStorage.delete(key),
    };

    function idempotencyKey(): string {
      const key = randomUUID();
      usedKeys.push(key);
      return key;
    }

    function multipartBody(
      payload: Record<string, unknown>,
      field: "cover" | "photo" | "logo",
      file: Buffer,
    ): { body: Buffer; contentType: string } {
      const boundary = `----ds1609${randomUUID()}`;
      return {
        body: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`,
          ),
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${field}.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          file,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    async function stillPng(): Promise<Buffer> {
      return sharp({
        create: {
          width: 40,
          height: 30,
          channels: 3,
          background: { r: 25, g: 80, b: 150 },
        },
      })
        .png()
        .toBuffer();
    }

    async function rowAndAuditCounts(table: string): Promise<[number, number]> {
      const rows = await pool.query(`SELECT count(*) FROM ${table}`);
      const audit = await pool.query(
        "SELECT count(*) FROM audit_ledger WHERE metadata->>'table' = $1",
        [table],
      );
      return [Number(rows.rows[0]!.count), Number(audit.rows[0]!.count)];
    }

    async function proveRefusalThenRecovery(input: {
      table: "projects" | "experts" | "partners";
      path: string;
      field: "cover" | "photo" | "logo";
      refColumn: "cover_ref" | "photo_ref" | "logo_ref";
      payload: Record<string, unknown>;
    }): Promise<void> {
      const before = await rowAndAuditCounts(input.table);
      const bytes = await stillPng();

      refusePuts = true;
      const refusedBody = multipartBody(input.payload, input.field, bytes);
      const refused = await app.inject({
        method: "POST",
        url: input.path,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": refusedBody.contentType,
          "idempotency-key": idempotencyKey(),
        },
        payload: refusedBody.body,
      });
      expect(refused.statusCode).toBe(503);
      expect(JSON.parse(refused.payload)).toMatchObject({
        errorCode: "MEDIA_STORAGE_UNAVAILABLE",
        title: "Object storage unavailable",
      });
      expect(await rowAndAuditCounts(input.table)).toEqual(before);

      // A provider refusal is terminal for its idempotency key. The operator's
      // retry is therefore a new command with a new key after storage recovers.
      refusePuts = false;
      const retryBody = multipartBody(input.payload, input.field, bytes);
      const retried = await app.inject({
        method: "POST",
        url: input.path,
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": retryBody.contentType,
          "idempotency-key": idempotencyKey(),
        },
        payload: retryBody.body,
      });
      expect(retried.statusCode, retried.payload).toBe(201);
      const id = (JSON.parse(retried.payload) as { id: string }).id;
      createdRows.push({ table: input.table, id });
      const stored = await pool.query<{ ref: string }>(
        `SELECT ${input.refColumn} AS ref FROM ${input.table} WHERE id = $1`,
        [id],
      );
      expect(stored.rows[0]!.ref).toMatch(
        new RegExp(`^taxonomy/${input.table}/`),
      );
      expect(await validStorage.exists(stored.rows[0]!.ref)).toBe(true);
    }

    beforeAll(async () => {
      await bucketClient.send(new CreateBucketCommand({ Bucket: bucket }));
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fakeIdp)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(BOT_PROTECTION)
        .useValue({
          verify: (): Promise<BotProtectionResult> =>
            Promise.resolve({ ok: true }),
        } satisfies BotProtection)
        .overrideProvider(OBJECT_STORAGE)
        .useValue(routedStorage)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);

      const email = `tax-real-store-${Date.now()}-${randomUUID().slice(0, 6)}@ds.test`;
      createdEmails.push(email);
      const registered = await registerUniqueFakeUserFixture({
        app,
        pool,
        fake: fakeIdp,
        nextEmail: () => email,
        password,
        consent,
      });
      await fakeIdp.grantProjectRole(registered.sub, "platform_admin");
      adminSid = (
        await establishAdminSession(app, {
          identifier: registered.email,
          password,
          device,
        })
      ).sid;
    });

    afterEach(async () => {
      refusePuts = false;
      for (const row of createdRows.splice(0)) {
        await pool.query(
          "DELETE FROM media_cleanup_jobs WHERE entity_id = $1",
          [row.id],
        );
        await pool.query(`DELETE FROM ${row.table} WHERE id = $1`, [row.id]);
      }
      for (const key of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [key]);
      }
    });

    afterAll(async () => {
      if (app) {
        for (const email of createdEmails.splice(0)) {
          await deleteUserFixture(pool, "email", email);
        }
        await app.close();
      }
      const listed = await bucketClient.send(
        new ListObjectsV2Command({ Bucket: bucket }),
      );
      const objects = (listed.Contents ?? []).flatMap(({ Key }) =>
        Key ? [{ Key }] : [],
      );
      if (objects.length > 0) {
        await bucketClient.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
      }
      await bucketClient.send(new DeleteBucketCommand({ Bucket: bucket }));
      bucketClient.destroy();
    });

    it("EARS-21: a real provider refusal leaves Project cover unchanged and a new valid retry succeeds", async () => {
      await proveRefusalThenRecovery({
        table: "projects",
        path: "/v1/admin/projects",
        field: "cover",
        refColumn: "cover_ref",
        payload: {
          kind: "school",
          title: `Real store project ${randomUUID().slice(0, 8)}`,
          description: "Real S3 acceptance fixture",
        },
      });
    });

    it("EARS-21: a real provider refusal leaves Expert photo unchanged and a new valid retry succeeds", async () => {
      await proveRefusalThenRecovery({
        table: "experts",
        path: "/v1/admin/experts",
        field: "photo",
        refColumn: "photo_ref",
        payload: {
          familyName: `RealStore-${randomUUID().slice(0, 8)}`,
          givenName: "Maria",
          patronymic: "Ivanovna",
          professionalRole: "Cardiologist",
          credentials: "MD",
          affiliation: "DS test fixture",
          bio: "Real S3 acceptance fixture",
        },
      });
    });

    it("EARS-21: a real provider refusal leaves Partner logo unchanged and a new valid retry succeeds", async () => {
      await proveRefusalThenRecovery({
        table: "partners",
        path: "/v1/admin/partners",
        field: "logo",
        refColumn: "logo_ref",
        payload: {
          title: `Real store partner ${randomUUID().slice(0, 8)}`,
          websiteUrl: "https://example.test/real-store-fixture",
        },
      });
    });
  },
);

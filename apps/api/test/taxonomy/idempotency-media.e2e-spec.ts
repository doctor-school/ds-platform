import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import {
  DRIZZLE_DB,
  DRIZZLE_POOL,
} from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  FakeObjectStorage,
  OBJECT_STORAGE,
  type ObjectStorage,
  type PutObjectInput,
} from "../../src/storage/index.js";
import { IdempotencyService } from "../../src/taxonomy/idempotency.service.js";
import { MediaCleanupService } from "../../src/taxonomy/media/media-cleanup.service.js";
import { adminHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

// 012 EARS-17 / §5.1 §6 (#1283) — the protocol properties that only show up
// against a real database and a real (fake-but-contract-parity) object store:
//
//  • an object-storage refusal is a terminal 503 with ZERO domain mutation;
//  • the cleanup worker fences on a newer epoch, rechecks live references and
//    reaches the fully cleared terminal shape;
//  • the 24-hour expiry clears content, closes replay and keeps the key forever;
//  • an exact-input retry may take over a LAPSED lease, and only a lapsed one.

/** An object store whose PUT always refuses — the outage under test. */
class RefusingStorage extends FakeObjectStorage {
  override put(_input: PutObjectInput): Promise<never> {
    return Promise.reject(new Error("object storage is unavailable"));
  }
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "012 EARS-17 idempotency records, media cleanup and storage outages (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let storage: FakeObjectStorage;
    let idempotency: IdempotencyService;
    let cleanup: MediaCleanupService;
    /**
     * The app's own Drizzle handle, resolved from DI. `enqueue` takes the
     * CALLER's transaction handle so the obligation commits with the ref change;
     * these protocol tests drive the worker rather than a command, so they pass
     * the same handle the app uses — never a second pool.
     */
    let db: Parameters<MediaCleanupService["enqueue"]>[0];
    const refusing = new RefusingStorage();
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "AdminTest/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdProjectIds: string[] = [];
    const usedKeys: string[] = [];
    const createdJobIds: string[] = [];
    let adminSid: string;
    /** Flipped per test: the OBJECT_STORAGE provider delegates to one of the two. */
    let refusePuts = false;

    beforeAll(async () => {
      const backing = new FakeObjectStorage();
      const routed: ObjectStorage = {
        put: (input) =>
          refusePuts ? refusing.put(input) : backing.put(input),
        urlFor: (k) => backing.urlFor(k),
        exists: (k) => backing.exists(k),
        getBytes: (k) => backing.getBytes(k),
        delete: (k) => backing.delete(k),
      };
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(OBJECT_STORAGE)
        .useValue(routed)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      storage = backing;
      idempotency = app.get(IdempotencyService);
      cleanup = app.get(MediaCleanupService);
      db = app.get(DRIZZLE_DB);

      const email = `tax-proto-${Date.now()}@ds.test`;
      createdEmails.push(email);
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      adminSid = (
        await establishAdminSession(app, { identifier: email, password, device })
      ).sid;
    });

    afterEach(async () => {
      refusePuts = false;
      for (const id of createdJobIds.splice(0)) {
        await pool.query("DELETE FROM media_cleanup_jobs WHERE id = $1", [id]);
      }
      for (const id of createdProjectIds.splice(0)) {
        await pool.query(
          "DELETE FROM media_cleanup_jobs WHERE entity_id = $1",
          [id],
        );
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const k of usedKeys.splice(0)) {
        await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [k]);
      }
    });

    afterAll(async () => {
      for (const email of createdEmails.splice(0)) {
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
      }
      await app.close();
    });

    function key(): string {
      const k = randomUUID();
      usedKeys.push(k);
      return k;
    }

    async function stillPng(width = 40, height = 30): Promise<Buffer> {
      return sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 10, g: 40, b: 90 },
        },
      })
        .png()
        .toBuffer();
    }

    function multipartBody(
      payload: unknown,
      file: Buffer,
    ): { body: Buffer; contentType: string } {
      const boundary = `----ds1283p${Math.random().toString(16).slice(2)}`;
      const chunks = [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`,
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="cover"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        file,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ];
      return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    it("012 EARS-17: when object storage refuses the PUT, the system shall answer 503 MEDIA_STORAGE_UNAVAILABLE with no project row and no audit row", async () => {
      const before = Number(
        (await pool.query("SELECT count(*) FROM projects")).rows[0]!.count,
      );
      const auditBefore = Number(
        (
          await pool.query(
            "SELECT count(*) FROM audit_ledger WHERE metadata->>'table' = 'projects'",
          )
        ).rows[0]!.count,
      );
      refusePuts = true;
      const mp = multipartBody(
        { kind: "media", title: "Проект с недоступным хранилищем" },
        await stillPng(),
      );
      const k = key();
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": k,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(503);
      expect((JSON.parse(res.payload) as { errorCode: string }).errorCode).toBe(
        "MEDIA_STORAGE_UNAVAILABLE",
      );
      expect(
        Number((await pool.query("SELECT count(*) FROM projects")).rows[0]!.count),
      ).toBe(before);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM audit_ledger WHERE metadata->>'table' = 'projects'",
            )
          ).rows[0]!.count,
        ),
      ).toBe(auditBefore);
      // The record retained the deterministic locator so a later sweep can
      // reclaim any object a partially-completed PUT might have left.
      const { rows } = await pool.query<{
        cleanup_object_key: string | null;
        execution_state: string;
      }>(
        "SELECT cleanup_object_key, execution_state FROM idempotency_keys WHERE key = $1",
        [k],
      );
      expect(rows[0]!.cleanup_object_key).toMatch(/^taxonomy\/projects\/covers\//);
      // The failed attempt never completed, so a retry is takeover-eligible.
      expect(rows[0]!.execution_state).toBe("processing");
    });

    it("012 EARS-1: when the cleanup worker runs, it shall fence on a newer epoch, delete the released object and reach the cleared terminal shape", async () => {
      const objectKey = `taxonomy/projects/covers/${randomUUID()}.webp`;
      await storage.put({
        key: objectKey,
        body: Buffer.from("released bytes"),
        contentType: "image/webp",
      });
      const jobId = await cleanup.enqueue(db, {
        cleanupKind: "replace",
        entityKind: "project",
        entityId: randomUUID(),
        slot: "cover",
        objectKey,
      });
      createdJobIds.push(jobId);
      const epochBefore = Number(
        (
          await pool.query("SELECT lease_epoch FROM media_cleanup_jobs WHERE id = $1", [
            jobId,
          ])
        ).rows[0]!.lease_epoch,
      );

      const completed = await cleanup.runDueJobs();
      expect(completed).toBeGreaterThanOrEqual(1);
      expect(await storage.exists(objectKey)).toBe(false);

      const { rows } = await pool.query<{
        status: string;
        execution_state: string;
        object_key: string | null;
        entity_id: string | null;
        lease_owner: string | null;
        lease_epoch: number;
        completed_at: string | null;
        cleanup_kind: string;
      }>("SELECT * FROM media_cleanup_jobs WHERE id = $1", [jobId]);
      expect(rows[0]).toMatchObject({
        status: "expired",
        execution_state: "completed",
        object_key: null,
        entity_id: null,
        lease_owner: null,
        cleanup_kind: "replace",
      });
      expect(rows[0]!.completed_at).not.toBeNull();
      expect(Number(rows[0]!.lease_epoch)).toBeGreaterThan(epochBefore);
    });

    it("012 EARS-1: when the released key is still referenced by a live row, the worker shall keep the object and leave the obligation open", async () => {
      const objectKey = `taxonomy/projects/covers/${randomUUID()}.webp`;
      await storage.put({
        key: objectKey,
        body: Buffer.from("still live"),
        contentType: "image/webp",
      });
      const { rows: created } = await pool.query<{ id: string }>(
        `INSERT INTO projects (slug, kind, title, cover_ref)
         VALUES ($1, 'school', 'Живой проект', $2) RETURNING id`,
        [`p-live-${randomUUID()}`, objectKey],
      );
      const projectId = created[0]!.id;
      createdProjectIds.push(projectId);
      const jobId = await cleanup.enqueue(db, {
        cleanupKind: "clear",
        entityKind: "project",
        entityId: projectId,
        slot: "cover",
        objectKey,
      });
      createdJobIds.push(jobId);

      const completed = await cleanup.runDueJobs();
      expect(completed).toBe(0);
      // The object a live row points at is NEVER deleted by a stale obligation.
      expect(await storage.exists(objectKey)).toBe(true);
      const { rows } = await pool.query<{
        status: string;
        execution_state: string;
        last_error: string;
      }>(
        "SELECT status, execution_state, last_error FROM media_cleanup_jobs WHERE id = $1",
        [jobId],
      );
      expect(rows[0]).toMatchObject({
        status: "active",
        execution_state: "pending",
        last_error: "still_referenced",
      });
    });

    it("012 EARS-17: when a record reaches 24 hours, one transaction shall clear its content, close replay and keep the key forever", async () => {
      const k = key();
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": k,
        },
        payload: { kind: "program", title: "Проект для истечения записи" },
      });
      expect(res.statusCode).toBe(201);
      createdProjectIds.push((JSON.parse(res.payload) as { id: string }).id);

      // Age the record past its window, then run the real expiry transaction.
      await pool.query(
        "UPDATE idempotency_keys SET expires_at = now() - interval '1 minute' WHERE key = $1",
        [k],
      );
      expect(await idempotency.expireDueRecords()).toBeGreaterThanOrEqual(1);
      const { rows } = await pool.query<{
        status: string;
        actor_id: string | null;
        request_fingerprint: string | null;
        response_body: unknown;
        deleted_at: string | null;
        response_status: number;
      }>("SELECT * FROM idempotency_keys WHERE key = $1", [k]);
      expect(rows[0]).toMatchObject({
        status: "expired",
        actor_id: null,
        request_fingerprint: null,
        response_body: null,
        response_status: 201,
      });
      expect(rows[0]!.deleted_at).not.toBeNull();

      // Replay is closed, and the key is not reusable by anyone.
      const reuse = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": k,
        },
        payload: { kind: "program", title: "Проект для истечения записи" },
      });
      expect(reuse.statusCode).toBe(409);
      expect(
        (JSON.parse(reuse.payload) as { errorCode: string }).errorCode,
      ).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("012 EARS-17: an in-flight identical request shall be refused, and only a LAPSED lease may be taken over by CAS", async () => {
      const k = key();
      const params = {
        key: k,
        scope: "taxonomy.projects",
        actorId: "actor-1",
        method: "POST",
        route: "/v1/admin/projects",
        fingerprint: "fp-stable",
      };
      const first = await idempotency.begin(params);
      expect(first.kind).toBe("owned");

      // A live lease is not stealable — guessing would double-apply.
      await expect(idempotency.begin(params)).rejects.toMatchObject({
        errorCode: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
      });

      await pool.query(
        "UPDATE idempotency_keys SET lease_expires_at = now() - interval '1 minute' WHERE key = $1",
        [k],
      );
      const takeover = await idempotency.begin(params);
      expect(takeover.kind).toBe("owned");
      if (takeover.kind === "owned") {
        expect(takeover.lease.leaseEpoch).toBe(2);
        // The superseded owner can no longer complete the record.
        if (first.kind === "owned") {
          await expect(
            idempotency.complete(db, first.lease, {
              status: 201,
              body: { stale: true },
            }),
          ).rejects.toThrow(/taken over/);
        }
      }
    });
  },
);

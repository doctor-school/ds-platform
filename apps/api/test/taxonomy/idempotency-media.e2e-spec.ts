import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { UploadReconcileService } from "../../src/taxonomy/media/upload-reconcile.service.js";
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
    let reconciler: UploadReconcileService;
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
      reconciler = app.get(UploadReconcileService);
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
      // The record retained the deterministic locator so the quiescent
      // reconciler can reclaim any object a partially-completed PUT left behind.
      const { rows } = await pool.query<{
        cleanup_object_key: string | null;
        execution_state: string;
        response_status: number | null;
        response_body: { errorCode?: string } | null;
      }>(
        `SELECT cleanup_object_key, execution_state, response_status, response_body
           FROM idempotency_keys WHERE key = $1`,
        [k],
      );
      expect(rows[0]!.cleanup_object_key).toMatch(/^taxonomy\/projects\/covers\//);
      // §5.1: the PUT failure "completes that idempotency outcome for replay" —
      // a fenced TERMINAL 503, not a takeover-eligible half-record.
      expect(rows[0]!.execution_state).toBe("completed");
      expect(rows[0]!.response_status).toBe(503);
      expect(rows[0]!.response_body?.errorCode).toBe("MEDIA_STORAGE_UNAVAILABLE");

      // An exact retry replays the stored refusal — even after storage recovers,
      // because the outcome of THAT request is terminal (§6 bullet 3). Anything
      // else would let one logical request both fail and succeed.
      refusePuts = false;
      const retry = await app.inject({
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
      expect(retry.statusCode).toBe(503);
      expect(
        (JSON.parse(retry.payload) as { errorCode: string }).errorCode,
      ).toBe("MEDIA_STORAGE_UNAVAILABLE");
      expect(
        Number((await pool.query("SELECT count(*) FROM projects")).rows[0]!.count),
      ).toBe(before);
    });

    it("012 EARS-17: every deterministic post-record refusal shall be fenced-stored and replayed on an exact retry", async () => {
      // Two 409s and one 412 — the invariant refusals of this handler. Each must
      // COMPLETE its record with the exact status/body, so an exact retry inside
      // the lease window replays the refusal instead of answering
      // IDEMPOTENCY_REQUEST_IN_PROGRESS (which would tell the operator "still
      // working" about a request that already reached its final answer).
      const seed = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": "application/json",
          "idempotency-key": key(),
        },
        payload: { kind: "school", title: `Занятый адрес ${Date.now()}` },
      });
      const seeded = JSON.parse(seed.payload) as { id: string; slug: string };
      createdProjectIds.push(seeded.id);
      await pool.query(
        "UPDATE projects SET status = 'published', first_published_at = now() WHERE id = $1",
        [seeded.id],
      );

      const cases: {
        code: string;
        status: number;
        request: () => Promise<{ statusCode: number; payload: string }>;
      }[] = [
        {
          code: "SLUG_CONFLICT",
          status: 409,
          request: () => {
            const k = key();
            return app.inject({
              method: "POST",
              url: "/v1/admin/projects",
              headers: {
                ...device,
                ...adminHeaders(adminSid),
                "content-type": "application/json",
                "idempotency-key": k,
              },
              payload: {
                kind: "media",
                title: "Другой проект",
                slug: seeded.slug,
              },
            }) as never;
          },
        },
        {
          code: "SLUG_IMMUTABLE",
          status: 409,
          request: () =>
            app.inject({
              method: "PATCH",
              url: `/v1/admin/projects/${seeded.id}`,
              headers: {
                ...device,
                ...adminHeaders(adminSid),
                "content-type": "application/json",
                "idempotency-key": key(),
                "if-match": 'W/"1"',
              },
              payload: { slug: "novyy-adres-posle-publikacii" },
            }) as never,
        },
        {
          code: "PRECONDITION_FAILED",
          status: 412,
          request: () =>
            app.inject({
              method: "PATCH",
              url: `/v1/admin/projects/${seeded.id}`,
              headers: {
                ...device,
                ...adminHeaders(adminSid),
                "content-type": "application/json",
                "idempotency-key": key(),
                "if-match": 'W/"99"',
              },
              payload: { title: "Устаревшая версия" },
            }) as never,
        },
      ];

      for (const c of cases) {
        // The SAME key must be used twice, so the request builder is invoked once
        // and its key read back off the record it created.
        const first = await c.request();
        expect(first.statusCode, c.code).toBe(c.status);
        const body = JSON.parse(first.payload) as { errorCode: string };
        expect(body.errorCode, c.code).toBe(c.code);
        const usedKey = usedKeys[usedKeys.length - 1]!;
        const { rows } = await pool.query<{
          execution_state: string;
          response_status: number | null;
          response_body: { errorCode?: string } | null;
        }>(
          `SELECT execution_state, response_status, response_body
             FROM idempotency_keys WHERE key = $1`,
          [usedKey],
        );
        expect(rows[0]!.execution_state, c.code).toBe("completed");
        expect(rows[0]!.response_status, c.code).toBe(c.status);
        expect(rows[0]!.response_body?.errorCode, c.code).toBe(c.code);
      }

      // And the replay itself: re-issue the SLUG_IMMUTABLE refusal under its own
      // key and check the second call returns the stored body verbatim.
      const replayKey = key();
      const send = () =>
        app.inject({
          method: "PATCH",
          url: `/v1/admin/projects/${seeded.id}`,
          headers: {
            ...device,
            ...adminHeaders(adminSid),
            "content-type": "application/json",
            "idempotency-key": replayKey,
            "if-match": 'W/"1"',
          },
          payload: { slug: "eshche-odin-adres" },
        });
      const original = await send();
      const replayed = await send();
      expect(original.statusCode).toBe(409);
      expect(replayed.statusCode).toBe(409);
      expect(JSON.parse(replayed.payload)).toEqual(JSON.parse(original.payload));
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

    it("012 EARS-17: the quiescent reconciler shall reclaim an unreferenced upload and clear its locator, and never touch a referenced one", async () => {
      // (a) An ORPHAN: a record that uploaded its canonical object and then ended
      // in a stored refusal, so no domain row ever referenced the bytes. Built
      // through the same three seams the command uses — reserve, note the
      // locator, PUT — so the row under test has the shape production produces.
      const orphanKey = key();
      const lease = await idempotency.begin({
        key: orphanKey,
        scope: "taxonomy.projects",
        actorId: "actor-reconcile",
        method: "POST",
        route: "/v1/admin/projects",
        fingerprint: "fp-orphan",
      });
      if (lease.kind !== "owned") throw new Error("expected to own the record");
      const orphanObject = `taxonomy/projects/covers/${orphanKey}-orphan.webp`;
      await idempotency.noteUploadLocator(lease.lease, orphanObject);
      await storage.put({
        key: orphanObject,
        body: Buffer.from("orphaned canonical bytes"),
        contentType: "image/webp",
        onlyIfAbsent: true,
      });
      await idempotency.storeTerminalOutcome(lease.lease, {
        status: 409,
        body: { errorCode: "SLUG_CONFLICT" },
      });

      // (b) A REFERENCED object: an ordinary successful create with a cover. Its
      // locator must be cleared WITHOUT deleting the bytes — deleting them would
      // blank a live cover, the worst outcome this sweep could produce.
      const mp = multipartBody(
        { kind: "school", title: `Проект со ссылкой ${Date.now()}` },
        await stillPng(),
      );
      const liveKey = key();
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/projects",
        headers: {
          ...device,
          ...adminHeaders(adminSid),
          "content-type": mp.contentType,
          "idempotency-key": liveKey,
        },
        payload: mp.body,
      });
      expect(created.statusCode).toBe(201);
      const liveProject = JSON.parse(created.payload) as { id: string };
      createdProjectIds.push(liveProject.id);
      const liveObject = (
        await pool.query<{ cover_ref: string }>(
          "SELECT cover_ref FROM projects WHERE id = $1",
          [liveProject.id],
        )
      ).rows[0]!.cover_ref;

      // Not yet quiescent: both records were created just now, so the sweep must
      // leave them alone — a late PUT from a superseded owner could still land.
      expect(await reconciler.reconcileDueLocators()).toBe(0);
      expect(await storage.exists(orphanObject)).toBe(true);

      // Age both past lease expiry + the in-flight/skew grace.
      await pool.query(
        `UPDATE idempotency_keys
            SET created_at = now() - interval '2 days',
                lease_expires_at = CASE WHEN lease_expires_at IS NULL THEN NULL
                                        ELSE now() - interval '2 days' END
          WHERE key = ANY($1::text[])`,
        [[orphanKey, liveKey]],
      );

      const reclaimed = await reconciler.reconcileDueLocators();
      expect(reclaimed).toBeGreaterThanOrEqual(2);

      // The orphan is gone from storage and its locator is cleared — §6's
      // "repeats until absence is acknowledged", acknowledged.
      expect(await storage.exists(orphanObject)).toBe(false);
      const orphanRow = await pool.query<{ cleanup_object_key: string | null }>(
        "SELECT cleanup_object_key FROM idempotency_keys WHERE key = $1",
        [orphanKey],
      );
      expect(orphanRow.rows[0]!.cleanup_object_key).toBeNull();

      // The referenced object survives, and its locator is cleared too (there is
      // nothing left to reclaim for that record).
      expect(await storage.exists(liveObject)).toBe(true);
      const liveRow = await pool.query<{ cleanup_object_key: string | null }>(
        "SELECT cleanup_object_key FROM idempotency_keys WHERE key = $1",
        [liveKey],
      );
      expect(liveRow.rows[0]!.cleanup_object_key).toBeNull();
    });

    it("012 EARS-17: request takeover and orphan cleanup shall be disjoint — the retry wins the lease, the object survives, and only the fenced owner clears the locator", async () => {
      // §6 "Request takeover and orphan cleanup are disjoint". The dangerous
      // interleaving: the sweep reads a takeover-ELIGIBLE row (still
      // `processing`, lease lapsed past the grace), then a retry CAS-takes the
      // record over and resumes on the still-present deterministic object. If
      // the sweep acted on that stale read it would delete the bytes the
      // resumed request is about to commit `cover_ref` to.
      const k = key();
      const params = {
        key: k,
        scope: "taxonomy.projects",
        actorId: "actor-race",
        method: "POST",
        route: "/v1/admin/projects",
        fingerprint: "fp-race",
      };
      const first = await idempotency.begin(params);
      if (first.kind !== "owned") throw new Error("expected to own the record");
      const racedObject = `taxonomy/projects/covers/${k}-race.webp`;
      await idempotency.noteUploadLocator(first.lease, racedObject);
      await storage.put({
        key: racedObject,
        body: Buffer.from("bytes the resumed request will commit"),
        contentType: "image/webp",
        onlyIfAbsent: true,
      });

      // Age the row so the sweep's read considers it due while `begin` still
      // considers the lapsed lease takeover-eligible — the overlap itself.
      await pool.query(
        `UPDATE idempotency_keys
            SET created_at = now() - interval '2 days',
                lease_expires_at = now() - interval '2 days'
          WHERE key = $1`,
        [k],
      );

      // The interleaving, made deterministic: the retry takes the record over
      // between the sweep's due-read and whatever the sweep does next.
      let takenOverEpoch = 0;
      const read = vi
        .spyOn(idempotency, "quiescentUploadLocators")
        .mockImplementation(async (cutoff, limit) => {
          read.mockRestore();
          const rows = await idempotency.quiescentUploadLocators(cutoff, limit);
          const takeover = await idempotency.begin(params);
          if (takeover.kind !== "owned")
            throw new Error("the retry must win the lapsed lease");
          takenOverEpoch = takeover.lease.leaseEpoch;
          return rows;
        });
      try {
        await reconciler.reconcileDueLocators();
      } finally {
        read.mockRestore();
      }

      // The takeover won: the object the resumed request owns is untouched and
      // its locator is still there for a LATER sweep to reclaim if this attempt
      // fails too.
      expect(takenOverEpoch).toBe(2);
      expect(await storage.exists(racedObject)).toBe(true);
      const raced = await pool.query<{
        cleanup_object_key: string | null;
        lease_epoch: number;
      }>(
        "SELECT cleanup_object_key, lease_epoch FROM idempotency_keys WHERE key = $1",
        [k],
      );
      expect(raced.rows[0]!.cleanup_object_key).toBe(racedObject);
      expect(raced.rows[0]!.lease_epoch).toBe(2);

      // And the clear itself is fenced on `(key, lease_epoch)`: the superseded
      // epoch clears nothing, only the current owner's epoch does.
      expect(await idempotency.clearReclaimedLocator(k, 1)).toBe(false);
      expect(
        (
          await pool.query<{ cleanup_object_key: string | null }>(
            "SELECT cleanup_object_key FROM idempotency_keys WHERE key = $1",
            [k],
          )
        ).rows[0]!.cleanup_object_key,
      ).toBe(racedObject);
      expect(await idempotency.clearReclaimedLocator(k, 2)).toBe(true);
      expect(
        (
          await pool.query<{ cleanup_object_key: string | null }>(
            "SELECT cleanup_object_key FROM idempotency_keys WHERE key = $1",
            [k],
          )
        ).rows[0]!.cleanup_object_key,
      ).toBeNull();
      await storage.delete(racedObject);
    });

    it("012 EARS-17: when a refused upload left no object at all, the reconciler shall acknowledge the absence and clear the locator", async () => {
      refusePuts = true;
      const k = key();
      const mp = multipartBody(
        { kind: "media", title: `Отказ хранилища ${Date.now()}` },
        await stillPng(),
      );
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
      const locator = (
        await pool.query<{ cleanup_object_key: string | null }>(
          "SELECT cleanup_object_key FROM idempotency_keys WHERE key = $1",
          [k],
        )
      ).rows[0]!.cleanup_object_key;
      expect(locator).not.toBeNull();
      expect(await storage.exists(locator!)).toBe(false);

      await pool.query(
        `UPDATE idempotency_keys SET created_at = now() - interval '2 days' WHERE key = $1`,
        [k],
      );
      expect(await reconciler.reconcileDueLocators()).toBeGreaterThanOrEqual(1);
      const after = await pool.query<{ cleanup_object_key: string | null }>(
        "SELECT cleanup_object_key FROM idempotency_keys WHERE key = $1",
        [k],
      );
      expect(after.rows[0]!.cleanup_object_key).toBeNull();
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

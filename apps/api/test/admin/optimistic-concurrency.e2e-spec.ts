import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import multipart from "@fastify/multipart";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import type { EventLifecycleState } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { authHeaders, establishAdminSession } from "../setup/admin-session.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { futureMskStart } from "../setup/wall-clock.js";

// 007 EARS-4/5/6/7 + 014 EARS-18 — optimistic concurrency on the admin event
// aggregate (#1593). Two operators may hold the same event open in the admin
// UI; without a validator the later save silently overwrites the earlier one,
// and a lifecycle command fires against a state the operator never saw.
//
// The contract mirrors 012's taxonomy surface exactly — one `version` integer
// per aggregate, surfaced as a weak `ETag` (`W/"<version>"`) on every admin
// read and echoed back as `If-Match` on every write that must be conditional:
//
//  1. the admin detail read emits the validator, and every committed admin
//     mutation bumps `version` by exactly one — so a held validator goes stale
//     on ANY change the detail read would have shown, not only a state change;
//  2. all SEVEN lifecycle commands — the four 007 broadcast commands (`publish` /
//     `open` / `close` / `hide`), 014's two LEGACY commands (`archive-legacy` /
//     `hide-legacy`, #1741) and the bare `transition` — REQUIRE `If-Match`:
//     absent is 428 `PRECONDITION_REQUIRED`, unparseable or stale is 412
//     `PRECONDITION_FAILED`. The protocol is a property of the fenced-command
//     BODY, not of any one machine, so the legacy commands are covered here
//     beside their broadcast siblings rather than in the 014 lifecycle suite;
//  3. the refusal is TOTAL — a refused command leaves the state, the version
//     and the ledger untouched;
//  4. a domain refusal is decided BEFORE the validator: a command that is
//     illegal at EVERY version answers with the reason it is illegal (409),
//     never «reload and retry».
//
// Runs against dev-stand Postgres + the fake IdP session; skips when absent so
// the shared CI unit job stays green.
describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "007/014 admin event optimistic concurrency — ETag / If-Match (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `${prefix}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** Register + login as a platform admin; return the session cookie value. */
    async function adminSession(email: string): Promise<string> {
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);

      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows[0]).toBeDefined();
      await fake.grantProjectRole(rows[0]!.zitadel_sub, "platform_admin");
      const admin = await establishAdminSession(app, {
        identifier: email,
        password,
        device,
      });
      return admin.sid;
    }

    /** Build a multipart/form-data body from string fields. */
    function multipartBody(fields: Record<string, string>): {
      body: Buffer;
      contentType: string;
    } {
      const boundary = `----ds1593${Math.random().toString(16).slice(2)}`;
      const chunks: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          ),
        );
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return {
        body: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    // Derived relative to now, never a literal date: an archival эфир is ABOUT a
    // broadcast already held (`test/setup/wall-clock.ts`).
    const PAST = () => futureMskStart(-30, "19:00");
    const FUTURE = () => futureMskStart(30, "19:00");

    function eventPayload(startsAtMsk: string, title: string) {
      return {
        title,
        school: "Кардиология",
        startsAtMsk,
        durationMin: 90,
        specialties: ["cardiology"],
      };
    }

    /** Create a fresh draft event through the EARS-1 create endpoint. */
    async function createDraft(
      cookie: string,
      startsAtMsk: string = FUTURE(),
    ): Promise<{ id: string; version: number; etag: string | undefined }> {
      const mp = multipartBody({
        payload: JSON.stringify(
          eventPayload(startsAtMsk, "Актуальная терапия ХСН"),
        ),
      });
      const res = await app.inject({
        method: "POST",
        url: "/v1/admin/events",
        headers: {
          ...device,
          ...authHeaders(cookie),
          "content-type": mp.contentType,
        },
        payload: mp.body,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; version: number };
      createdEventIds.push(body.id);
      return {
        id: body.id,
        version: body.version,
        etag: res.headers.etag as string | undefined,
      };
    }

    /** The admin detail read — the validator source the UI holds. */
    async function adminDetail(cookie: string, id: string) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/admin/events/${id}`,
        headers: { ...device, ...authHeaders(cookie) },
      });
      expect(res.statusCode).toBe(200);
      return {
        etag: res.headers.etag as string | undefined,
        body: res.json() as { state: EventLifecycleState; version: number },
      };
    }

    async function persistedVersion(id: string): Promise<number | undefined> {
      const { rows } = await pool.query<{ version: number }>(
        "SELECT version FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.version;
    }

    async function persistedState(id: string): Promise<string | undefined> {
      const { rows } = await pool.query<{ state: string }>(
        "SELECT state FROM events WHERE id = $1",
        [id],
      );
      return rows[0]?.state;
    }

    /**
     * Bump the stored version behind the caller's back — the other operator's
     * save, reduced to the single fact the validator is about.
     */
    async function concurrentWrite(id: string): Promise<void> {
      await pool.query(
        "UPDATE events SET version = version + 1 WHERE id = $1",
        [id],
      );
    }

    /** Force a persisted lifecycle state without running the sibling commands. */
    async function forceState(id: string, state: EventLifecycleState) {
      await pool.query("UPDATE events SET state = $1 WHERE id = $2", [
        state,
        id,
      ]);
    }

    /**
     * 014 EARS-24/25 (#1741) — a `legacy` эфир carrying a PUBLISHED recording,
     * i.e. one for which «Архивировать» is legal on the domain. Built through the
     * real creation + publish routes rather than forced with SQL: the archive
     * precondition is resolved against the recording projection, so a hand-forged
     * row would exercise the validator against a fixture the domain would refuse.
     */
    async function archivableLegacy(cookie: string): Promise<string> {
      const id = await legacyWithDraftRecording(cookie);
      const { rows } = await pool.query<{ id: string; version: number }>(
        "SELECT id, version FROM event_recordings WHERE event_id = $1",
        [id],
      );
      expect(rows).toHaveLength(1);
      const published = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/recordings/${rows[0]!.id}/publish`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          "if-match": `W/"${rows[0]!.version}"`,
          "idempotency-key": randomUUID(),
        },
      });
      expect(published.statusCode).toBe(200);
      return id;
    }

    /**
     * The same эфир one step earlier: created, born `hidden`, its recording still
     * `draft`. «Архивировать» is refused 409 `EVENT_NOT_FINISHED` here at every
     * version — the domain refusal the fenced ordering is probed against.
     */
    async function legacyWithDraftRecording(cookie: string): Promise<string> {
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/legacy-broadcasts",
        headers: {
          ...device,
          ...authHeaders(cookie),
          "content-type": "application/json",
        },
        payload: {
          title: `Архивный эфир ${randomUUID().slice(0, 8)}`,
          heldAtMsk: PAST(),
          durationMin: 90,
          specialties: ["cardiology"],
          speakers: [{ name: "И. И. Иванов", regalia: "д.м.н." }],
          recording: {
            kind: "edited",
            provider: "youtube",
            embedRef: "dQw4w9WgXcQ",
          },
        },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as { id: string }).id;
      createdEventIds.push(id);
      return id;
    }

    /**
     * The seven conditional lifecycle commands, each with the fixture that makes
     * it legal — so every row exercises the validator, never a domain refusal.
     */
    const COMMANDS = [
      {
        name: "publish",
        path: "publish",
        arrange: async (cookie: string) => (await createDraft(cookie)).id,
      },
      {
        name: "open",
        path: "open",
        arrange: async (cookie: string) => {
          const { id } = await createDraft(cookie);
          await forceState(id, "published");
          return id;
        },
      },
      {
        name: "close",
        path: "close",
        arrange: async (cookie: string) => {
          const { id } = await createDraft(cookie);
          await pool.query(
            "UPDATE events SET state = 'live', live_at = now() WHERE id = $1",
            [id],
          );
          return id;
        },
      },
      {
        name: "hide",
        path: "hide",
        arrange: async (cookie: string) => {
          const { id } = await createDraft(cookie);
          await forceState(id, "ended");
          return id;
        },
      },
      {
        // 014 EARS-25 (#1741) — the legacy machine's `hidden → in_archive`. Its
        // fenced protocol is the SAME body as its broadcast siblings; the fixture
        // differs (a real эфир with a published recording), the contract does not.
        name: "archive-legacy",
        path: "archive-legacy",
        idempotent: true,
        arrange: async (cookie: string) => archivableLegacy(cookie),
      },
      {
        // 014 EARS-25 — `in_archive → hidden`, the reversible counterpart.
        name: "hide-legacy",
        path: "hide-legacy",
        idempotent: true,
        arrange: async (cookie: string) => {
          const id = await archivableLegacy(cookie);
          await forceState(id, "in_archive");
          return id;
        },
      },
      {
        name: "transition",
        path: "transition",
        body: { to: "published" as const },
        arrange: async (cookie: string) => (await createDraft(cookie)).id,
      },
    ] as const;

    type Command = (typeof COMMANDS)[number];

    /** POST one lifecycle command with an explicit `If-Match` (or none). */
    async function command(
      cmd: Command,
      cookie: string,
      id: string,
      ifMatch: string | null,
    ) {
      const body = "body" in cmd ? cmd.body : undefined;
      return app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/${cmd.path}`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          ...(body ? { "content-type": "application/json" } : {}),
          ...("idempotent" in cmd ? { "idempotency-key": randomUUID() } : {}),
          ...(ifMatch === null ? {} : { "if-match": ifMatch }),
        },
        ...(body ? { payload: body } : {}),
      });
    }

    beforeAll(async () => {
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
      await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0))
        await deleteEventFixture(pool, id);
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app.close();
    });

    it("EARS-4: the admin detail read emits the version as a weak ETag and on the body, and a freshly created event starts at version 1", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const created = await createDraft(cookie);

      // The create response is itself a detail read: an operator who creates
      // and immediately commands must not need a second round-trip first.
      expect(created.version).toBe(1);
      expect(created.etag).toBe('W/"1"');

      const read = await adminDetail(cookie, created.id);
      expect(read.etag).toBe('W/"1"');
      expect(read.body.version).toBe(1);
      expect(await persistedVersion(created.id)).toBe(1);
    });

    it("EARS-4: the authoring PATCH bumps the version, so a validator held from before the edit is stale even though the state never moved", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const { id } = await createDraft(cookie);

      const edit = multipartBody({
        payload: JSON.stringify({
          ...eventPayload(FUTURE(), "Актуальная терапия ХСН — обновлено"),
          durationMin: 120,
        }),
      });
      const patched = await app.inject({
        method: "PATCH",
        url: `/v1/admin/events/${id}`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          "content-type": edit.contentType,
        },
        payload: edit.body,
      });
      expect(patched.statusCode).toBe(200);
      // The authoring write is deliberately NOT itself conditional (#1593
      // scopes the precondition to the six lifecycle commands) — but it MUST
      // move the validator, or a stale lifecycle command would slip through.
      expect((patched.json() as { version: number }).version).toBe(2);
      expect(patched.headers.etag).toBe('W/"2"');
      expect(await persistedVersion(id)).toBe(2);
    });

    it.each(COMMANDS.map((c) => [c.name, c] as const))(
      "EARS-7: %s without an If-Match is refused 428 PRECONDITION_REQUIRED, leaving state and version untouched",
      async (_name, cmd) => {
        const cookie = await adminSession(uniqueEmail("admin"));
        const id = await cmd.arrange(cookie);
        const before = await adminDetail(cookie, id);

        const res = await command(cmd, cookie, id, null);
        expect(res.statusCode).toBe(428);
        expect((res.json() as { code: string }).code).toBe(
          "PRECONDITION_REQUIRED",
        );

        expect(await persistedState(id)).toBe(before.body.state);
        expect(await persistedVersion(id)).toBe(before.body.version);
      },
    );

    it.each(COMMANDS.map((c) => [c.name, c] as const))(
      "EARS-7: %s with an unparseable If-Match is refused 412 PRECONDITION_FAILED — a validator the server never issued is not a wildcard",
      async (_name, cmd) => {
        const cookie = await adminSession(uniqueEmail("admin"));
        const id = await cmd.arrange(cookie);
        const before = await adminDetail(cookie, id);

        for (const raw of ['W/"garbage"', "*"]) {
          const res = await command(cmd, cookie, id, raw);
          expect(res.statusCode, `If-Match: ${raw}`).toBe(412);
          expect((res.json() as { code: string }).code).toBe(
            "PRECONDITION_FAILED",
          );
        }

        expect(await persistedState(id)).toBe(before.body.state);
        expect(await persistedVersion(id)).toBe(before.body.version);
      },
    );

    it.each(COMMANDS.map((c) => [c.name, c] as const))(
      "EARS-7: %s with a stale If-Match is refused 412 after a concurrent write, and the same command succeeds once the validator is re-read",
      async (_name, cmd) => {
        const cookie = await adminSession(uniqueEmail("admin"));
        const id = await cmd.arrange(cookie);
        const held = await adminDetail(cookie, id);
        expect(held.etag).toBeDefined();

        // The other operator saves while this one holds the form open.
        await concurrentWrite(id);
        const stateBefore = await persistedState(id);

        const stale = await command(cmd, cookie, id, held.etag!);
        expect(stale.statusCode).toBe(412);
        expect((stale.json() as { code: string }).code).toBe(
          "PRECONDITION_FAILED",
        );
        // Total refusal: the command did not half-apply.
        expect(await persistedState(id)).toBe(stateBefore);

        // Reload-and-retry is the whole point of the refusal: the SAME command
        // with the CURRENT validator goes through.
        const fresh = await adminDetail(cookie, id);
        const ok = await command(cmd, cookie, id, fresh.etag!);
        expect(ok.statusCode).toBe(200);
      },
    );

    it.each(COMMANDS.map((c) => [c.name, c] as const))(
      "EARS-7: %s with the current If-Match applies and answers with the NEXT validator on both the ETag and the body",
      async (_name, cmd) => {
        const cookie = await adminSession(uniqueEmail("admin"));
        const id = await cmd.arrange(cookie);
        const held = await adminDetail(cookie, id);

        const res = await command(cmd, cookie, id, held.etag!);
        expect(res.statusCode).toBe(200);

        const next = held.body.version + 1;
        expect((res.json() as { version: number }).version).toBe(next);
        expect(res.headers.etag).toBe(`W/"${next}"`);
        expect(await persistedVersion(id)).toBe(next);

        // A client that chains two commands off one response must not need a
        // re-read: replaying the SPENT validator is refused.
        const replay = await command(cmd, cookie, id, held.etag!);
        expect(replay.statusCode).not.toBe(200);
      },
    );

    it("EARS-7: the bare integer form of If-Match is accepted — a client that echoes a stripped validator is never punished for the weak-ETag syntax", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const { id } = await createDraft(cookie);

      const res = await command(COMMANDS[0], cookie, id, "1");
      expect(res.statusCode).toBe(200);
      expect(await persistedState(id)).toBe("published");
    });

    it("EARS-7: a domain refusal is decided BEFORE the validator — an illegal transition answers 409, not 412, even when the If-Match is also stale", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const { id } = await createDraft(cookie);
      const held = await adminDetail(cookie, id);
      await concurrentWrite(id);

      // `hide` from `draft` is illegal at EVERY version: answering 412 would
      // send the operator to reload a form that would refuse just the same.
      const res = await command(COMMANDS[3], cookie, id, held.etag!);
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe("INVALID_TRANSITION");
      expect(await persistedState(id)).toBe("draft");
    });

    it("014 EARS-25: archive-legacy decides EVENT_NOT_FINISHED before the validator, and its Idempotency-Key check comes first of all", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      // An эфир whose recording is still `draft` — «Архивировать» is illegal at
      // EVERY version, which is what makes it the right probe for the ordering.
      const id = await legacyWithDraftRecording(cookie);
      const held = await adminDetail(cookie, id);

      // Key shape first — a request that never bound a record cannot be judged
      // against a validator.
      const noKey = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/archive-legacy`,
        headers: { ...device, ...authHeaders(cookie) },
      });
      expect(noKey.statusCode).toBe(428);
      expect((noKey.json() as { code: string }).code).toBe(
        "IDEMPOTENCY_KEY_REQUIRED",
      );

      // …then the DOMAIN refusal, ahead of the stale validator: a command that
      // is illegal whatever version it was read at answers with the reason it is
      // illegal, never «reload and retry».
      await concurrentWrite(id);
      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/archive-legacy`,
        headers: {
          ...device,
          ...authHeaders(cookie),
          "idempotency-key": randomUUID(),
          "if-match": held.etag!,
        },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe("EVENT_NOT_FINISHED");
      expect(await persistedState(id)).toBe("hidden");
    });

    it("014 EARS-25: after a 412 the archive-legacy retry must mint a NEW Idempotency-Key — the raw validator is bound into the fingerprint, so the same key with the reloaded validator is a REUSE", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const id = await archivableLegacy(cookie);
      const held = await adminDetail(cookie, id);
      await concurrentWrite(id);

      const key = randomUUID();
      const archive = (ifMatch: string, idempotencyKey: string) =>
        app.inject({
          method: "POST",
          url: `/v1/admin/events/${id}/archive-legacy`,
          headers: {
            ...device,
            ...authHeaders(cookie),
            "idempotency-key": idempotencyKey,
            "if-match": ifMatch,
          },
        });

      // The stale validator is refused 412, and that refusal is deliberately NOT
      // fence-stored (only a deterministic domain 409 is) — it is a property of
      // the caller's read, not of the bound request.
      const stale = await archive(held.etag!, key);
      expect(stale.statusCode).toBe(412);
      expect((stale.json() as { code: string }).code).toBe(
        "PRECONDITION_FAILED",
      );
      expect(await persistedState(id)).toBe("hidden");

      // Reloading the validator makes the request a DIFFERENT bound request, so
      // replaying the ORIGINAL key against it is a reuse, not a retry.
      const reloaded = await adminDetail(cookie, id);
      const reused = await archive(reloaded.etag!, key);
      expect(reused.statusCode).toBe(409);
      expect((reused.json() as { code: string }).code).toBe(
        "IDEMPOTENCY_KEY_REUSED",
      );
      expect(await persistedState(id)).toBe("hidden");

      // A fresh key plus the reloaded validator is the correct retry, and it
      // applies exactly once.
      const retried = await archive(reloaded.etag!, randomUUID());
      expect(retried.statusCode).toBe(200);
      expect(await persistedState(id)).toBe("in_archive");
    });

    it("EARS-7: a conditional command against a non-existent event is a 404 — the validator never leaks whether the id exists", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const res = await command(
        COMMANDS[0],
        cookie,
        "00000000-0000-4000-8000-000000000000",
        'W/"1"',
      );
      expect(res.statusCode).toBe(404);
    });

    it("EARS-8: the precondition never runs before authorization — an unauthenticated conditional command is 401, not 428", async () => {
      const cookie = await adminSession(uniqueEmail("admin"));
      const { id } = await createDraft(cookie);

      const res = await app.inject({
        method: "POST",
        url: `/v1/admin/events/${id}/publish`,
        headers: { ...device },
      });
      expect(res.statusCode).toBe(401);
      expect(await persistedState(id)).toBe("draft");
    });
  },
);

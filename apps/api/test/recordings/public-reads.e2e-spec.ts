import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import multipart from "@fastify/multipart";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/session/session.cookie.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import {
  deleteExpertFixtures,
  seedEventSpeakers,
} from "../setup/speaker-fixtures.js";

// 014 EARS-4 (#1341) — the PUBLIC read behind the post-live event page, over the
// real stack. Two promises are under test here and they pull in opposite
// directions, which is why they share one suite:
//
//   1. COMPLETENESS — a visitor with no account gets every field of feature
//      004's `PublicEventPage` allow-list. The page is complete on the 004
//      projection alone; nothing about it waits on the 012 taxonomy wave.
//   2. SOURCE-FREEDOM — the same response carries the recording projection and
//      NOT one byte of playable source. The login gate of 014-design §5 is a
//      response-body fact, so «the guest cannot play it» is asserted against the
//      serialized payload, not against a rendering rule.
//
// The recordings are inserted directly rather than driven through the admin
// lifecycle: #1339 owns those transitions and re-driving them here would let an
// unrelated admin-protocol failure fail a suite about a public read. What this
// read consumes is the published, non-retired row set — so the fixture writes
// exactly that.

/** A realistic provider-scoped rutube id (#1134) — never a pasted URL. */
const EDITED_REF = "0123456789abcdef0123456789abcdef";
const RAW_REF = "fedcba9876543210fedcba9876543210";

interface PublicPageBody {
  id: string;
  slug: string;
  title: string;
  school: string;
  startsAt: string;
  durationMin: number;
  description: string;
  speakers: { source: string; name: string }[];
  specialties: string[];
  partners: { label: string }[];
  programPdfUrl?: string;
  state: string;
  recording: {
    state: string;
    primaryKind: string | null;
    secondaryKind: string | null;
    posterUrl: string | null;
    expectedBy: string | null;
  };
}

/** The authenticated playback body of 014-design §5 — sources or two nulls. */
interface PlaybackBody {
  primary: {
    kind: string;
    provider: string;
    embedRef: string;
    posterRef: string | null;
    durationSec: number | null;
  } | null;
  secondary: PlaybackBody["primary"];
}

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "014 EARS-4 / EARS-5 post-live event reads (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const fake = new FakeIdpClient();
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];
    const createdEmails: string[] = [];
    const password = "Aa1!ufficiently-long-pw";
    const device = { "user-agent": "Test/1.0", "accept-language": "en-US" };
    const consent = [{ purpose: "tos", version: "2026-01" }];

    /**
     * One event in the given lifecycle state, carrying the full 004 allow-list
     * so «every field present and readable» is a real assertion rather than a
     * tour of nulls.
     */
    async function insertEvent(
      state: string,
      overrides: {
        programPdfRef?: string | null;
        partnerRef?: string | null;
        recordingExpectedBy?: string | null;
      } = {},
    ): Promise<{ id: string; slug: string }> {
      const slug = `pub-1341-${randomUUID()}`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events
           (slug, title, school, description, starts_at, duration_min, state,
            specialties, partner_ref, program_pdf_ref, recording_expected_by)
         VALUES ($1, $2, $3, $4, now() - interval '3 days', 90, $5,
                 $6, $7, $8, $9)
         RETURNING id`,
        [
          slug,
          "Пластика ахиллова сухожилия: разбор клинических случаев",
          "Школа травматологии и ортопедии",
          "Три реальных случая — от выбора техники до реабилитации.",
          state,
          ["Травматология", "Ортопедия"],
          overrides.partnerRef === undefined
            ? "Фарм-партнёр"
            : overrides.partnerRef,
          overrides.programPdfRef ?? null,
          overrides.recordingExpectedBy ?? null,
        ],
      );
      const id = rows[0]!.id;
      createdEventIds.push(id);
      return { id, slug };
    }

    /**
     * One speaker — since 012 EARS-24 that is an eligible expert linked through
     * `event_experts`, the projection's ONLY source.
     */
    async function insertSpeaker(
      eventId: string,
      familyName: string,
      givenName: string,
      pos: number,
    ) {
      createdExpertIds.push(
        ...(await seedEventSpeakers(
          pool,
          eventId,
          [
            {
              familyName,
              givenName,
              credentials: "Травматолог-ортопед, к.м.н.",
            },
          ],
          pos,
        )),
      );
    }

    /** A published, non-retired recording — exactly what the resolver reads. */
    async function publishRecording(
      eventId: string,
      kind: "edited" | "raw",
      posterRef: string | null = null,
    ) {
      await pool.query(
        `INSERT INTO event_recordings
           (event_id, kind, provider, embed_ref, poster_ref, status,
            first_published_at)
         VALUES ($1, $2, 'rutube', $3, $4, 'published', now())`,
        [eventId, kind, kind === "edited" ? EDITED_REF : RAW_REF, posterRef],
      );
    }

    async function read(key: string) {
      return app.inject({ method: "GET", url: `/v1/public/events/${key}` });
    }

    /**
     * Register + login a doctor and return the session cookie value. The account
     * is created through the REAL 003 commands, so «a signed-in doctor» in the
     * EARS-5 scenarios is an actual session the guard resolves, never a stub.
     */
    async function doctorSession(prefix: string): Promise<string> {
      const email = `${prefix}-${randomUUID()}@ds.test`;
      createdEmails.push(email);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: device,
        payload: { identifier: email, password },
      });
      expect(res.statusCode).toBe(200);
      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME);
      expect(cookie).toBeDefined();
      return cookie!.value;
    }

    function cookieHeader(cookie: string): Record<string, string> {
      return { ...device, cookie: `${SESSION_COOKIE_NAME}=${cookie}` };
    }

    /** The authenticated playback read — the ONE source-bearing 014 response. */
    function readPlayback(key: string, headers: Record<string, string>) {
      return app.inject({
        method: "GET",
        url: `/v1/events/${key}/recordings`,
        headers,
      });
    }

    async function readBody(key: string): Promise<PublicPageBody> {
      const res = await read(key);
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload) as PublicPageBody;
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(fake)
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        // Hermetic: the register fixture path behind `doctorSession` must not
        // depend on the recipe's bot-protection env/flag state (an enabled
        // SmartCaptcha rejects the token-less test register with a 403
        // BOT_PROTECTION_REQUIRED). Bot protection is not under test here.
        .overrideProvider(BOT_PROTECTION)
        .useValue({
          verify: (): Promise<BotProtectionResult> =>
            Promise.resolve({ ok: true }),
        } satisfies BotProtection)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterEach(async () => {
      for (const id of createdEventIds.splice(0)) {
        await pool.query("DELETE FROM event_recordings WHERE event_id = $1", [
          id,
        ]);
        await deleteEventFixture(pool, id);
      }
      for (const email of createdEmails.splice(0)) {
        await deleteUserFixture(pool, "email", email);
      }
      await deleteExpertFixtures(pool, createdExpertIds.splice(0));
    });

    afterAll(async () => {
      await app.close();
    });

    it("014 EARS-4.1: when a visitor with no account opens an ended event, the public read shall carry every field of the 004 PublicEventPage projection", async () => {
      const { id, slug } = await insertEvent("ended", {
        programPdfRef: "programs/1341.pdf",
      });
      await insertSpeaker(id, "Соколова", "Анна", 1);
      await insertSpeaker(id, "Верещагин", "Михаил", 2);
      await publishRecording(id, "edited");

      // No cookie, no auth header — the read is issued exactly as a sponsor-link
      // recipient's browser would issue it.
      const body = await readBody(slug);

      expect(body).toMatchObject({
        id,
        slug,
        title: "Пластика ахиллова сухожилия: разбор клинических случаев",
        school: "Школа травматологии и ортопедии",
        durationMin: 90,
        description: "Три реальных случая — от выбора техники до реабилитации.",
        specialties: ["Травматология", "Ортопедия"],
        partners: [{ label: "Фарм-партнёр" }],
        state: "ended",
      });
      // The start instant is the canonical UTC ISO-8601 value every surface
      // renders in МСК — present and parseable, never a pre-formatted string.
      expect(Number.isNaN(Date.parse(body.startsAt))).toBe(false);
      expect(body.speakers.map((s) => s.name)).toEqual([
        "Соколова Анна",
        "Верещагин Михаил",
      ]);
      // The program PDF is a SIGNED, dereferenceable URL — «present when
      // present» is the promise, and a bare storage key would render as a dead
      // link (#842: prod served an unsigned URL the private bucket denied). The
      // scheme belongs to the storage adapter (`memory://` under the fake,
      // `https://` under S3), so the assertion is on the two facts that are
      // adapter-independent: it is not the bare ref, and it carries a signature.
      expect(body.programPdfUrl).toBeTypeOf("string");
      expect(body.programPdfUrl).toContain("programs/1341.pdf");
      expect(body.programPdfUrl).not.toBe("programs/1341.pdf");
      expect(body.programPdfUrl).toContain("?");
    });

    it("014 EARS-4.2: the same response shall carry the source-free recording projection and no playable source at all", async () => {
      const { id, slug } = await insertEvent("ended");
      await publishRecording(id, "edited", "posters/1341.webp");

      const res = await read(slug);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as PublicPageBody;

      expect(body.recording).toEqual({
        state: "montage",
        primaryKind: "edited",
        secondaryKind: null,
        posterUrl: "posters/1341.webp",
        expectedBy: null,
      });
      // The projection's own keys are the whole contract — a source field added
      // to it later would be caught here rather than in a guest's HTML.
      expect(Object.keys(body.recording).sort()).toEqual([
        "expectedBy",
        "posterUrl",
        "primaryKind",
        "secondaryKind",
        "state",
      ]);
      // …and the serialized payload as a whole carries neither the embed
      // reference nor a provider name anywhere, at any nesting depth.
      expect(res.payload).not.toContain(EDITED_REF);
      expect(res.payload).not.toContain("rutube");
      expect(res.payload).not.toContain("embedRef");
      expect(res.payload).not.toContain("provider");
    });

    it("014 EARS-4.3: the recording field shall be the canonical resolver's projection, tracking what is published rather than a page-local rule", async () => {
      const montage = await insertEvent("ended");
      await publishRecording(montage.id, "edited");
      await publishRecording(montage.id, "raw");
      const rawOnly = await insertEvent("ended");
      await publishRecording(rawOnly.id, "raw");
      const none = await insertEvent("ended", {
        recordingExpectedBy: "2026-09-15",
      });

      // Both kinds published: the edited cut is the primary, the raw capture the
      // secondary — the EARS-3 rule, read through the same resolver.
      expect((await readBody(montage.slug)).recording).toMatchObject({
        state: "montage",
        primaryKind: "edited",
        secondaryKind: "raw",
      });
      expect((await readBody(rawOnly.slug)).recording).toMatchObject({
        state: "raw-only",
        primaryKind: "raw",
        secondaryKind: null,
      });
      // Nothing published: `preparing` carrying the operator's readiness date.
      // The plaque that renders it is #1344; the projection that feeds it is here.
      expect((await readBody(none.slug)).recording).toMatchObject({
        state: "preparing",
        primaryKind: null,
        secondaryKind: null,
        expectedBy: "2026-09-15",
      });
    });

    it("014 EARS-4.4: the post-live state shall live on the single 004 route — no mirror, no archive-only variant, no hidden-announcement read", async () => {
      const { id, slug } = await insertEvent("ended");
      await publishRecording(id, "edited");

      // The id form and the slug form are the SAME projection: one route, two
      // keys, byte-identical bodies.
      const bySlug = await read(slug);
      const byId = await read(id);
      expect(bySlug.statusCode).toBe(200);
      expect(byId.statusCode).toBe(200);
      expect(byId.payload).toBe(bySlug.payload);

      // No archive mirror exists to read the same event through.
      for (const mirror of [
        `/v1/public/hide/events/${slug}`,
        `/v1/public/events/${slug}/hide`,
        `/v1/public/recordings/${slug}`,
      ]) {
        const res = await app.inject({ method: "GET", url: mirror });
        expect(res.statusCode).toBe(404);
      }
    });

    it("014 EARS-4.5: a hidden event shall keep its feature 004 render — the same 200 notice body, still source-free, never a post-live page", async () => {
      const { id, slug } = await insertEvent("hidden");
      // Attached and published BEFORE hiding — the row exists, and the
      // hidden render must not turn into a post-live page because of it.
      await publishRecording(id, "edited");

      const res = await read(slug);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as PublicPageBody;
      // 004 EARS-5: `hidden` resolves to a 200 hidden-notice body on this
      // same route — never a 404 and never a redirect.
      expect(body.state).toBe("hidden");
      expect(res.payload).not.toContain(EDITED_REF);
      expect(res.payload).not.toContain("embedRef");
    });

    it("014 EARS-4.6: a draft event shall stay unreadable, so adding the projection opens no oracle on a hidden announcement", async () => {
      const { slug } = await insertEvent("draft");
      const res = await read(slug);
      // Indistinguishable from an unknown id (004 EARS-6) — the recording field
      // must not become a side channel that says «this slug exists».
      expect(res.statusCode).toBe(404);
      expect(res.payload).not.toContain("recording");
    });

    // ---------------------------------------------------------------------
    // 014 EARS-5 (#1343) — the login gate as a READ SPLIT (014-design §5).
    //
    // The public read above is the guest's whole answer and it carries no
    // source. The authenticated `GET /v1/events/:idOrSlug/recordings` is the
    // ONE source-bearing response in the feature. Its guard is
    // `access: authenticated` and nothing else: no registration, no attendance,
    // no 014-specific role. That "nothing else" is asserted, not assumed —
    // EARS-5.2 signs in a doctor who never registered for the event.
    // ---------------------------------------------------------------------

    it("014 EARS-5.1: when the playback endpoint is read with no session, it shall refuse with 401 and hand out no playable source", async () => {
      const { id, slug } = await insertEvent("ended");
      await publishRecording(id, "edited");

      // The public read is complete for the guest — and source-free (EARS-4.2).
      const publicRes = await read(slug);
      expect(publicRes.statusCode).toBe(200);
      expect(publicRes.payload).not.toContain(EDITED_REF);

      // The playback read is the gate, and the gate is SERVER-SIDE: the refusal
      // is a status code, not a rendering rule.
      const res = await readPlayback(slug, device);
      expect(res.statusCode).toBe(401);
      expect(res.payload).not.toContain(EDITED_REF);
      expect(res.payload).not.toContain("embedRef");
      // A crafted/forged cookie is the same refusal — the guard authenticates
      // against the real session store, so an invented value never yields one.
      const forged = await readPlayback(
        slug,
        cookieHeader("forged-session-id-that-does-not-exist"),
      );
      expect(forged.statusCode).toBe(401);
      expect(forged.payload).not.toContain(EDITED_REF);
    });

    it("014 EARS-5.2: when a signed-in doctor who never registered opens the event, the playback read shall return the resolver-selected source", async () => {
      const { id, slug } = await insertEvent("ended");
      await publishRecording(id, "edited", "posters/1343.webp");
      await publishRecording(id, "raw");

      // No registration is created for this doctor anywhere in this test: the
      // 005 roster is deliberately untouched, and the read still succeeds.
      const cookie = await doctorSession("doc-1343-unreg");
      const res = await readPlayback(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as PlaybackBody;

      // The EARS-3 rule decides which cut plays — the same resolver the public
      // projection reads, not a second "which cut wins" implementation.
      expect(body.primary).toMatchObject({
        kind: "edited",
        provider: "rutube",
        embedRef: EDITED_REF,
        posterRef: "posters/1343.webp",
      });
      expect(body.secondary).toMatchObject({
        kind: "raw",
        provider: "rutube",
        embedRef: RAW_REF,
      });
      // The response is per-caller and behind a gate — never shared-cacheable.
      expect(res.headers["cache-control"]).toContain("no-store");
    });

    it("014 EARS-5.3: a preparing event shall answer the authenticated read with 200 and two nulls — the plaque is not an error", async () => {
      const { slug } = await insertEvent("ended", {
        recordingExpectedBy: "2026-09-15",
      });
      const cookie = await doctorSession("doc-1343-preparing");

      const res = await readPlayback(slug, cookieHeader(cookie));
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({
        primary: null,
        secondary: null,
      });
    });

    it("014 EARS-5.4: the playback read shall track the published row set and leak no hidden event through the gate", async () => {
      const rawOnly = await insertEvent("ended");
      await publishRecording(rawOnly.id, "raw");
      const draft = await insertEvent("draft");
      await publishRecording(draft.id, "edited");
      const cookie = await doctorSession("doc-1343-rowset");
      const headers = cookieHeader(cookie);

      // Raw alone plays as the primary, with no secondary affordance at all.
      const raw = await readPlayback(rawOnly.slug, headers);
      expect(raw.statusCode).toBe(200);
      const rawBody = JSON.parse(raw.payload) as PlaybackBody;
      expect(rawBody.primary).toMatchObject({ kind: "raw", embedRef: RAW_REF });
      expect(rawBody.secondary).toBeNull();

      // A draft event is invisible on the public read (EARS-4.6); authenticating
      // must not turn the playback route into the oracle that reveals it.
      const hidden = await readPlayback(draft.slug, headers);
      expect(hidden.statusCode).toBe(404);
      expect(hidden.payload).not.toContain(EDITED_REF);

      // An unknown key is the same 404 — indistinguishable from the above.
      const unknown = await readPlayback(`no-such-${randomUUID()}`, headers);
      expect(unknown.statusCode).toBe(404);
    });

    it("014 EARS-5.5: a retired event shall refuse the authenticated playback read exactly as the public read does, so signing in is not an oracle on a soft-deleted event", async () => {
      const { id, slug } = await insertEvent("ended");
      await publishRecording(id, "edited");
      // Soft-delete the EVENT itself (004's `record_status`; the table's CHECK
      // ties `retired` to a non-null `deleted_at`). The recording row stays
      // published — the point is that the event's retirement, not the cut's,
      // decides the answer.
      await pool.query(
        `UPDATE events SET record_status = 'retired', deleted_at = now() WHERE id = $1`,
        [id],
      );

      const cookie = await doctorSession("doc-1343-retired");
      const headers = cookieHeader(cookie);

      // The public read refuses (004's ACTIVE_EVENT filter)…
      const publicRes = await read(slug);
      expect(publicRes.statusCode).toBe(404);

      // …and authenticating must produce the IDENTICAL refusal. A 200 here
      // would hand `provider` + `embedRef` for an event the platform says
      // does not exist.
      const res = await readPlayback(slug, headers);
      expect(res.statusCode).toBe(404);
      expect(res.payload).not.toContain(EDITED_REF);
      expect(res.payload).not.toContain("embedRef");

      // The uuid arm resolves the same way — the retirement filter is on the
      // event row, not on which key spelled it.
      const byId = await readPlayback(id, headers);
      expect(byId.statusCode).toBe(404);
      expect(byId.payload).not.toContain(EDITED_REF);
    });
  },
);

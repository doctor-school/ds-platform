import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { DoctorConfirmResponseSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient, FAKE_VALID_CODE } from "../../src/auth/idp/idp.fake.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * 021 EARS-10 (#1546) — the post-confirmation landing, at the api layer.
 *
 * The doctor who started at an event page and went through email verification
 * must come back to THAT event. This suite proves the command end to end over
 * real rows: registration, the 003 verification hop, and the landing the server
 * resolves from the carried target.
 *
 * The target is carried IN-APP (in the query of the doctor host's code-entry
 * URL) and is re-validated here, server-side, at confirmation time — 003
 * verification emails are code-only and link-free by decision (003 EARS-29,
 * #910/#1045), so nothing about the landing ever travels through the email.
 *
 * What is asserted, beyond the happy path: a target the guard rejects is
 * ABSENT, never a 4xx (a doctor who typed the right code must never be told
 * their registration failed because of a URL they never typed), and a failed
 * confirmation leaks no landing at all.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "021 EARS-10 doctor confirmation — the carried return target (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;

    const runId = Date.now();
    const createdEmails: string[] = [];
    const createdEventIds: string[] = [];

    const PASSWORD = "Aa1!ufficiently-long-pw";
    const REGISTER_URL = "/v1/storefront/doctor/register";
    const CONFIRM_URL = "/v1/storefront/doctor/confirm";

    function uniqueEmail(tag: string): string {
      const email = `ears10-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    /** A real `events` row in `state`, returned by its public slug. */
    async function makeEvent(state: string): Promise<string> {
      const id = randomUUID();
      const slug = `ears10-${randomUUID()}`;
      await pool.query(
        "INSERT INTO events (id, slug, title, school, starts_at, duration_min, state) VALUES ($1, $2, $3, $4, $5, 60, $6)",
        [
          id,
          slug,
          "021 EARS-10 fixture",
          "Школа 021",
          new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          state,
        ],
      );
      createdEventIds.push(id);
      return slug;
    }

    /** Registers a fresh doctor and returns the email awaiting confirmation. */
    async function registerDoctor(tag: string): Promise<string> {
      const email = uniqueEmail(tag);
      const res = await app.inject({
        method: "POST",
        url: REGISTER_URL,
        payload: { email, password: PASSWORD, medicalWorkerDeclaration: true },
      });
      expect(res.statusCode).toBe(200);
      return email;
    }

    /** The confirm command, with or without a carried target. */
    async function confirm(input: {
      email: string;
      code?: string;
      returnTo?: string;
    }) {
      return app.inject({
        method: "POST",
        url: CONFIRM_URL,
        payload: {
          email: input.email,
          code: input.code ?? FAKE_VALID_CODE,
          ...(input.returnTo === undefined ? {} : { returnTo: input.returnTo }),
        },
      });
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
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
    }, 60_000);

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      const ids = createdEventIds.splice(0);
      if (ids.length > 0 && pool)
        await pool.query("DELETE FROM events WHERE id = ANY($1::uuid[])", [ids]);
      await app?.close();
    });

    it("021 EARS-10.1: a live event target sends the doctor back to that event, with the cabinet offered second", async () => {
      const slug = await makeEvent("published");
      const email = await registerDoctor("live");

      const res = await confirm({ email, returnTo: `/events/${slug}` });

      expect(res.statusCode).toBe(200);
      const body = DoctorConfirmResponseSchema.parse(res.json());
      expect(body.status).toBe("verified");
      // The href is the guard's own reconstruction, never the raw input.
      expect(body.primaryAction).toEqual({
        kind: "return",
        href: `/events/${slug}`,
      });
      // «в личный кабинет» is present and SECONDARY — never the default outcome.
      expect(body.secondaryAction).toEqual({ kind: "cabinet", href: "/account" });
      // Release 1 credits no points (#1545): the absence is stated, not faked.
      expect(body.credited).toBeNull();
    });

    it("021 EARS-10.2: an эфир that already ended lands on that event's own page, saying why", async () => {
      const slug = await makeEvent("ended");
      const email = await registerDoctor("ended");

      const res = await confirm({ email, returnTo: `/events/${slug}` });

      expect(res.statusCode).toBe(200);
      const body = DoctorConfirmResponseSchema.parse(res.json());
      // LD-8's nearest honest destination: the page still exists, so it is the
      // destination — but the action is a `landing`, not a silent `return`.
      expect(body.primaryAction).toEqual({
        kind: "landing",
        href: `/events/${slug}`,
        reason: "ended",
      });
    });

    it("021 EARS-10.3: a hidden event has no destination worth landing on, so the feed answers with `unpublished`", async () => {
      const slug = await makeEvent("hidden");
      const email = await registerDoctor("hidden");

      const res = await confirm({ email, returnTo: `/events/${slug}` });

      expect(res.statusCode).toBe(200);
      const body = DoctorConfirmResponseSchema.parse(res.json());
      expect(body.primaryAction).toEqual({
        kind: "landing",
        href: "/events",
        reason: "unpublished",
      });
    });

    it("021 EARS-10.4: a target whose event no longer exists lands on the feed, saying why", async () => {
      const email = await registerDoctor("missing");

      const res = await confirm({
        email,
        returnTo: `/events/ears10-${randomUUID()}`,
      });

      expect(res.statusCode).toBe(200);
      const body = DoctorConfirmResponseSchema.parse(res.json());
      // A draft and a non-existent id collapse into ONE answer on purpose —
      // 004 EARS-6 forbids the existence oracle.
      expect(body.primaryAction).toEqual({
        kind: "landing",
        href: "/events",
        reason: "missing",
      });
    });

    it("021 EARS-10.5: a hostile return target is treated as absent — never followed, never a 4xx", async () => {
      // Every one of these is a target the doctor never typed. The confirmation
      // they DID type must still succeed; the URL is simply dropped.
      const hostile = [
        "https://evil.example.com/events/x",
        "//evil.example.com",
        "/events/../account",
        "/events/a/b",
        "/events/a%2Fb",
        "/webinars/some-academy-event",
      ];

      for (const returnTo of hostile) {
        const email = await registerDoctor("hostile");
        const res = await confirm({ email, returnTo });

        expect(res.statusCode).toBe(200);
        const body = DoctorConfirmResponseSchema.parse(res.json());
        expect(body.status).toBe("verified");
        // Absent, so LD-4's default — and NO `reason`: nothing degraded, there
        // was never a target to degrade from.
        expect(body.primaryAction).toEqual({ kind: "landing", href: "/events" });
        await deleteUserFixture(pool, "email", email);
        createdEmails.splice(createdEmails.indexOf(email), 1);
      }
    });

    it("021 EARS-10.6: a cold confirmation — no target in hand — lands per LD-4 with no reason attached", async () => {
      const email = await registerDoctor("cold");

      const res = await confirm({ email });

      expect(res.statusCode).toBe(200);
      const body = DoctorConfirmResponseSchema.parse(res.json());
      expect(body.primaryAction).toEqual({ kind: "landing", href: "/events" });
      expect(body.secondaryAction).toEqual({ kind: "cabinet", href: "/account" });
    });

    it("021 EARS-10.7: a wrong code fails generically and leaks no landing at all", async () => {
      const slug = await makeEvent("published");
      const email = await registerDoctor("wrongcode");

      const res = await confirm({
        email,
        code: "000000",
        returnTo: `/events/${slug}`,
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      // The failure body is the 003 generic problem (ADR-0002 / RFC 7807): no
      // `primaryAction`, no `secondaryAction`, no slug — a caller cannot use a
      // rejected code to probe which events exist.
      const raw = res.payload;
      expect(raw).not.toContain("primaryAction");
      expect(raw).not.toContain("secondaryAction");
      expect(raw).not.toContain(slug);
    });
  },
);

import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  DoctorRegisterResponseSchema,
  PARTNER_DATA_SHARING_PURPOSE,
} from "@ds/schemas";
import { PARTNER_DATA_SHARING_VERSION } from "../../src/storefront/doctor-register.service.js";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  InMemoryRegisterNoticeThrottle,
  REGISTER_NOTICE_THROTTLE,
} from "../../src/mailer/register-notice-throttle.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";

/**
 * 021 EARS-3 (#1539) — THE DIRECT-ARRIVAL COMMAND, at the api layer.
 *
 * A doctor who opened `/register` on their own sends the registration command
 * with NO return target in it — not an empty string, not a null field, no key
 * at all. This suite proves the two halves of that:
 *
 *   1. the command is a first-class one, not a degraded gate registration: it
 *      completes to `pending_verification` and DELEGATES to the shipped 003
 *      engine (real IdP user, real PD mirror row), so the direct arrival is not
 *      a second, thinner path through registration;
 *   2. the response leaks NO landing and NO return target. `data-registration-landing`
 *      is a fact the doctor storefront resolves for itself from the entry URL
 *      and 017's remembered specialty (`apps/doctor/lib/registration-landing.ts`,
 *      LD-4); the api is not asked where the doctor should go and does not
 *      answer it. The strict response shape is what enforces that, and it is
 *      asserted here so no future slice can quietly widen the envelope.
 *
 * WHY THE REQUEST CONTRACT IS UNCHANGED. It would be easy to add a
 * `returnTarget` field here «for #1546». That field would have no consumer in
 * this slice — the carried target and its confirmation-time re-validation are
 * EARS-10 (#1546) and LD-3 — and an unconsumed field on a shipped public
 * contract is exactly the untracked seam AGENTS.md §6 forbids. So the direct
 * arrival is proven as what it is: the payload without the key.
 *
 * The IdP port is bound to the in-memory fake exactly as
 * `doctor-register-consents.e2e-spec.ts` binds it — Zitadel is the credential
 * authority (003 design §2) and is not reachable from the shared CI database
 * job, so what is proven here is the DELEGATION to the same seam
 * `zitadel-create-user.e2e-spec.ts` proves against a live Zitadel.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "021 EARS-3 doctor registration — the direct arrival (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let mailer: FakeMailer;
    const runId = Date.now();
    const createdEmails: string[] = [];
    const PASSWORD = "Aa1!ufficiently-long-pw";
    // EARS-5 (#1541): the second access-condition purpose is required alongside
    // the declaration; these arrivals grant it so the EARS-3 landing is reached.
    const PARTNER_CONSENT = [
      {
        purpose: PARTNER_DATA_SHARING_PURPOSE,
        version: PARTNER_DATA_SHARING_VERSION,
      },
    ];
    const URL = "/v1/storefront/doctor/register";

    function uniqueEmail(tag: string): string {
      const email = `ears3-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    beforeAll(async () => {
      // The mailer is INSPECTABLE here, not merely satisfied: 003 EARS-23 is a
      // clause whose entire observable is an out-of-band email, so a suite that
      // does not hold the mailer cannot tell a dispatched notice from a
      // swallowed one.
      mailer = new FakeMailer();
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient(mailer))
        .overrideProvider(MAILER)
        .useValue(mailer)
        // The throttle is bound to the in-memory adapter the module itself
        // falls back to without a `REDIS_URL`, so this suite's outcome does not
        // depend on a Redis being reachable from the database job. The throttle
        // WINDOW is 003's own subject (`auth.service.spec.ts`); what is proven
        // here is only that the doctor door reaches the EARS-23 branch at all.
        .overrideProvider(REGISTER_NOTICE_THROTTLE)
        .useValue(new InMemoryRegisterNoticeThrottle(`doctor-register-${runId}`))
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
      await app?.close();
    });

    it("021 EARS-3.1: a command carrying no return target at all completes and delegates to the 003 engine", async () => {
      const email = uniqueEmail("direct");

      const res = await app.inject({
        method: "POST",
        url: URL,
        // The direct arrival, spelled exactly: no `returnTarget`, no
        // `returnTo`, no empty stand-in for one.
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: PARTNER_CONSENT,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(DoctorRegisterResponseSchema.parse(res.json()).status).toBe(
        "pending_verification",
      );

      // Not a thinner path: the IdP user and the PD mirror row exist, which is
      // what makes this a registration rather than an accepted no-op.
      const { rows } = await pool.query(
        "SELECT role, email_verified, zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("doctor_guest");
      expect(rows[0].zitadel_sub).toBeTruthy();
      // The doctor still has to confirm the address — the direct arrival does
      // not skip verification, it only changes where they land afterwards.
      expect(rows[0].email_verified).toBe(false);
    });

    it("021 EARS-3.2: the response carries no landing and no return target — the strict envelope is the whole answer", async () => {
      const email = uniqueEmail("envelope");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: PARTNER_CONSENT,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // The strict schema refuses any extra key, so this is the assertion that
      // a landing can never be smuggled into the envelope.
      expect(DoctorRegisterResponseSchema.parse(body)).toEqual({
        status: "pending_verification",
      });
      expect(Object.keys(body)).toEqual(["status"]);
      for (const key of ["landing", "returnTo", "returnTarget", "redirect"]) {
        expect(body).not.toHaveProperty(key);
      }
    });

    it("021 EARS-3.3: a client-supplied return target is not part of this command — it changes nothing and is not echoed back", async () => {
      const email = uniqueEmail("ignored");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: PARTNER_CONSENT,
          // There is no return-target field in the contract (LD-3: the carried
          // target and its re-validation are #1546). A client that invents one
          // must not be able to make the api store, honour or reflect it.
          returnTo: "https://evil.example/steal",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "pending_verification" });

      const { rows } = await pool.query(
        "SELECT role FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("doctor_guest");
    });

    it("003 EARS-23: a repeat registration through the DOCTOR door dispatches the account-exists notice, with the response unchanged", async () => {
      // The gap this closes, found while driving the Stage-B slot: a doctor who
      // registers twice on doctor.school gets the identical EARS-16 response,
      // and the only thing that tells the legitimate owner what happened is the
      // EARS-23 notice. `AuthService.register` dispatches it for BOTH doors —
      // but nothing here proved the storefront door reaches that branch, so a
      // future storefront-local short-circuit of the duplicate case would have
      // left the owner silently stranded with a green suite.
      const email = uniqueEmail("duplicate");
      const payload = {
        email,
        password: PASSWORD,
        medicalWorkerDeclaration: true,
        consent: PARTNER_CONSENT,
      };

      const first = await app.inject({ method: "POST", url: URL, payload });
      expect(first.statusCode).toBe(200);
      const noticesBefore = mailer.accountExistsNotices.length;

      const second = await app.inject({ method: "POST", url: URL, payload });

      // EARS-16 — the response is byte-identical to the never-registered case;
      // the door is no existence oracle.
      expect(second.statusCode).toBe(first.statusCode);
      expect(second.json()).toEqual({ status: "pending_verification" });

      // EARS-23 — the dispatch is fire-and-forget (deliberately off the
      // response path, so SMTP latency cannot become a timing oracle), so the
      // assertion polls instead of reading once: a single read would be a race
      // that passes on a fast machine and flakes on CI.
      await expect
        .poll(() => mailer.accountExistsNotices.slice(noticesBefore), {
          timeout: 5_000,
        })
        .toEqual([email.toLowerCase()]);

      // The duplicate registers NOTHING: still exactly the one account the
      // first command created.
      const { rows } = await pool.query(
        "SELECT role FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
    });
  },
);

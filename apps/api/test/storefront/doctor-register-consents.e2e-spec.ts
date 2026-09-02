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
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { deleteUserFixture } from "../setup/fixture-cleanup.js";
import {
  DoctorRegisterService,
  MEDICAL_WORKER_DECLARATION_VERSION,
} from "../../src/storefront/doctor-register.service.js";

/**
 * 021 EARS-4 (#1540) — the mandatory medical-worker declaration on the doctor
 * storefront's registration command.
 *
 * The declaration is a PRECONDITION, not a field: there is no "ask later" form,
 * no partial variant and no path that completes registration without it. These
 * tests prove the refusal at both layers that can be reached — the contract
 * (`z.literal(true)`, before the handler runs) and the domain guard (which is
 * what a future non-DTO caller meets) — and prove that the accepted path does
 * NOT stop at the guard but delegates to the shipped 003 engine, creating the
 * real IdP user, the mirror row and the versioned per-purpose consent record.
 *
 * The IdP port is bound to the in-memory fake exactly as the 003 register e2e
 * binds it: Zitadel is the credential authority (003 design §2) and is not
 * reachable from the shared CI database job, so the *delegation* is what is
 * proven here — the same seam `zitadel-create-user.e2e-spec.ts` proves against a
 * live Zitadel.
 *
 * The declaration is a DECLARATION, not a verification: nothing in this suite
 * asks for a document, and no confirmed-status claim is written anywhere (that
 * stays with features 022 / 037).
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "021 EARS-4 doctor registration — medical-worker declaration (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let doctorRegister: DoctorRegisterService;
    const runId = Date.now();
    const createdEmails: string[] = [];
    const PASSWORD = "Aa1!ufficiently-long-pw";
    const URL = "/v1/storefront/doctor/register";

    function uniqueEmail(tag: string): string {
      const email = `ears4-${tag}-${runId}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function accountExists(email: string): Promise<boolean> {
      const { rows } = await pool.query(
        "SELECT 1 FROM users WHERE email = $1",
        [email],
      );
      return rows.length > 0;
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
      doctorRegister = app.get(DoctorRegisterService);
    }, 60_000);

    afterEach(async () => {
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
    });

    afterAll(async () => {
      await app?.close();
    });

    it("EARS-4.1: a registration that omits the medical-worker declaration is refused and creates no account", async () => {
      const email = uniqueEmail("omitted");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: { email, password: PASSWORD },
      });

      // Refused at the contract layer — `medicalWorkerDeclaration` is
      // `z.literal(true)`, so a payload without it is not a `RegisterDoctor`
      // command at all and never reaches the handler.
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(await accountExists(email)).toBe(false);
    });

    it("EARS-4.2: a registration that declines the declaration is refused — there is no partial variant and no 'ask later' path", async () => {
      const email = uniqueEmail("declined");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: { email, password: PASSWORD, medicalWorkerDeclaration: false },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(await accountExists(email)).toBe(false);
    });

    it("EARS-4.3: the domain guard refuses a withheld declaration with the stable code, before any IdP side-effect", async () => {
      const email = uniqueEmail("guard");

      // Bypasses the DTO pipe deliberately: the contract check and the domain
      // rule are two different guarantees, and only the domain one survives a
      // caller that does not go through the HTTP boundary.
      await expect(
        doctorRegister.register({
          email,
          password: PASSWORD,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          medicalWorkerDeclaration: false as any,
          consent: [],
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: MEDICAL_WORKER_DECLARATION_REQUIRED_CODE },
      });

      expect(await accountExists(email)).toBe(false);
    });

    it("EARS-4.4: with the declaration the command is accepted and delegates to the 003 engine — account, mirror role and one versioned dated declaration record", async () => {
      const email = uniqueEmail("accepted");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: { email, password: PASSWORD, medicalWorkerDeclaration: true },
      });

      expect(res.statusCode).toBe(200);
      expect(DoctorRegisterResponseSchema.parse(res.json()).status).toBe(
        "pending_verification",
      );

      // The accept path is NOT a stub: the 003 engine created the IdP user and
      // the PD mirror row behind it.
      const { rows } = await pool.query(
        "SELECT role, email_verified, zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("doctor_guest");
      expect(rows[0].zitadel_sub).toBeTruthy();

      // EARS-7's mechanism, exercised through EARS-4's purpose: a versioned,
      // dated, per-purpose row through the existing consent store — no 021-local
      // ledger and no boolean column.
      const consentRows = await pool.query(
        "SELECT purpose, version, captured_at FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1",
        [email],
      );
      expect(consentRows.rows).toHaveLength(1);
      expect(consentRows.rows[0].purpose).toBe(
        MEDICAL_WORKER_DECLARATION_PURPOSE,
      );
      expect(consentRows.rows[0].version).toBe(
        MEDICAL_WORKER_DECLARATION_VERSION,
      );
      expect(consentRows.rows[0].captured_at).toBeTruthy();
    });

    it("EARS-4.5: the declaration record is written once even if the client also supplies the purpose itself — the ticked box is the row", async () => {
      const email = uniqueEmail("dedup");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          // A client-supplied copy of the same purpose, with a version of its
          // own choosing. The command derives the row from the flag, so the
          // client cannot stamp a version the doctor never read, and cannot
          // produce a duplicate row.
          consent: [
            {
              purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
              version: "attacker-chosen",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);

      const consentRows = await pool.query(
        "SELECT purpose, version FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1",
        [email],
      );
      expect(consentRows.rows).toEqual([
        {
          purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
          version: MEDICAL_WORKER_DECLARATION_VERSION,
        },
      ]);
    });
  },
);

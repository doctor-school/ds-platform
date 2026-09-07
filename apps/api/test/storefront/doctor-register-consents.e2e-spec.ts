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
  MARKETING_COMMUNICATIONS_PURPOSE,
  MEDICAL_WORKER_DECLARATION_PURPOSE,
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  PARTNER_DATA_SHARING_PURPOSE,
  PARTNER_DATA_SHARING_REQUIRED_CODE,
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
  MARKETING_COMMUNICATIONS_VERSION,
  MEDICAL_WORKER_DECLARATION_VERSION,
  PARTNER_DATA_SHARING_VERSION,
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
  "021 doctor registration — the consent block, EARS-4/5/6/7 (e2e)",
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
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          // EARS-5 (#1541) made the partner-data consent the SECOND access
          // condition, so an accepted payload now carries both. This clause is
          // still about the declaration's own row; the partner-data row is
          // asserted by EARS-5.2 below.
          consent: [
            {
              purpose: PARTNER_DATA_SHARING_PURPOSE,
              version: PARTNER_DATA_SHARING_VERSION,
            },
          ],
        },
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
      const declaration = consentRows.rows.find(
        (row) => row.purpose === MEDICAL_WORKER_DECLARATION_PURPOSE,
      );
      expect(declaration).toBeDefined();
      expect(declaration.version).toBe(MEDICAL_WORKER_DECLARATION_VERSION);
      expect(declaration.captured_at).toBeTruthy();
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
            {
              purpose: PARTNER_DATA_SHARING_PURPOSE,
              version: PARTNER_DATA_SHARING_VERSION,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);

      const consentRows = await pool.query(
        "SELECT purpose, version FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1",
        [email],
      );
      const declarationRows = consentRows.rows.filter(
        (row) => row.purpose === MEDICAL_WORKER_DECLARATION_PURPOSE,
      );
      expect(declarationRows).toEqual([
        {
          purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
          version: MEDICAL_WORKER_DECLARATION_VERSION,
        },
      ]);
    });

    /**
     * 021 EARS-5 (#1541) — the partner-data consent is the SECOND access
     * condition of the two-tier block, not a preference: withheld, the command
     * is refused before any IdP call; granted, it produces its own versioned,
     * dated row beside the declaration's.
     *
     * The tier RENDERING (two tiers, the stated composition, neither box
     * pre-ticked) is a browser fact and lives in
     * `apps/doctor/e2e/register-consent-tiers.spec.ts`; what a server test can
     * prove is that the door does not open without it.
     */
    it("021 EARS-5.1: a registration without the partner-data consent is refused with its own code, and no account is created", async () => {
      const email = uniqueEmail("no-partner-data");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: { email, password: PASSWORD, medicalWorkerDeclaration: true },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        code: PARTNER_DATA_SHARING_REQUIRED_CODE,
        missingConsentPurposes: [PARTNER_DATA_SHARING_PURPOSE],
      });
      // Refused BEFORE the IdP call — the declaration alone opens nothing.
      expect(await accountExists(email)).toBe(false);
    });

    it("021 EARS-5.2: with both access conditions the command is accepted and writes two versioned dated rows", async () => {
      const email = uniqueEmail("both-tier1");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: [
            {
              purpose: PARTNER_DATA_SHARING_PURPOSE,
              // A version of the client's choosing: the server stamps the
              // wording version it actually rendered, so this cannot land.
              version: "attacker-chosen",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(await accountExists(email)).toBe(true);

      const consentRows = await pool.query(
        "SELECT purpose, version, captured_at FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY purpose",
        [email],
      );
      expect(
        consentRows.rows.map((row) => ({
          purpose: row.purpose,
          version: row.version,
        })),
      ).toEqual([
        {
          purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
          version: MEDICAL_WORKER_DECLARATION_VERSION,
        },
        {
          purpose: PARTNER_DATA_SHARING_PURPOSE,
          version: PARTNER_DATA_SHARING_VERSION,
        },
      ]);
      // EARS-7's "each granted consent … with its date", per purpose.
      for (const row of consentRows.rows)
        expect(row.captured_at).toBeTruthy();
    });

    /**
     * 021 EARS-6 (#1542) / EARS-7 (#1543) — the optional tier and the record
     * semantics of one submit.
     *
     * EARS-6 is a claim about CONSEQUENCE, not about a checkbox: withholding the
     * marketing opt-in must change nothing except the absence of its row — same
     * status, same body, same account, same access-condition rows. That is why
     * 6.1 and 6.2 are written as a pair and compared against each other.
     *
     * EARS-7 is the record itself: one versioned, dated row per granted purpose
     * — no duplicate, no row for a purpose that was not granted, no row for a
     * purpose this surface never rendered, and never a version the caller chose.
     * `consent_records` is append-only with no status column, so a wrong row
     * here is permanent; withdrawal is a manager-side operation of feature 037.
     */
    async function consentRowsFor(email: string) {
      const { rows } = await pool.query(
        "SELECT purpose, version, captured_at FROM consent_records cr JOIN users u ON u.id = cr.user_id WHERE u.email = $1 ORDER BY purpose",
        [email],
      );
      return rows;
    }

    it("021 EARS-6.1: withholding the marketing opt-in registers the doctor and writes no marketing row", async () => {
      const email = uniqueEmail("marketing-withheld");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: [
            { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(DoctorRegisterResponseSchema.parse(res.json()).status).toBe(
        "pending_verification",
      );
      expect(await accountExists(email)).toBe(true);

      // No row at all — not a row carrying a "granted: false" flag, which this
      // append-only table has no column for anyway.
      expect((await consentRowsFor(email)).map((row) => row.purpose)).toEqual([
        MEDICAL_WORKER_DECLARATION_PURPOSE,
        PARTNER_DATA_SHARING_PURPOSE,
      ]);
    });

    it("021 EARS-6.2: granting the marketing opt-in changes nothing but adds exactly one marketing row", async () => {
      const withheldEmail = uniqueEmail("optional-baseline");
      const grantedEmail = uniqueEmail("marketing-granted");
      const basePayload = {
        password: PASSWORD,
        medicalWorkerDeclaration: true,
      };

      const withheld = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          ...basePayload,
          email: withheldEmail,
          consent: [
            { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
          ],
        },
      });
      const granted = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          ...basePayload,
          email: grantedEmail,
          consent: [
            { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
            { purpose: MARKETING_COMMUNICATIONS_PURPOSE, version: "2026-09" },
          ],
        },
      });

      // "Genuinely optional": the opt-in buys the doctor nothing at the door and
      // costs them nothing. Same status, same body.
      expect(granted.statusCode).toBe(withheld.statusCode);
      expect(granted.statusCode).toBe(200);
      expect(granted.json()).toEqual(withheld.json());
      expect(await accountExists(grantedEmail)).toBe(true);

      expect(
        (await consentRowsFor(grantedEmail)).map((row) => row.purpose),
      ).toEqual([
        MARKETING_COMMUNICATIONS_PURPOSE,
        MEDICAL_WORKER_DECLARATION_PURPOSE,
        PARTNER_DATA_SHARING_PURPOSE,
      ]);
    });

    it("021 EARS-6.3: a purpose this surface never renders is refused at the boundary and reaches no record", async () => {
      const email = uniqueEmail("undeclared-purpose");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: [
            { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
            { purpose: "analytics-profiling", version: "2026-09" },
          ],
        },
      });

      // 400 from the contract pipe, before the guard and before any IdP call:
      // an append-only consent row naming wording no doctor ever saw is not
      // something a later request can take back.
      expect(res.statusCode).toBe(400);
      expect(await accountExists(email)).toBe(false);
      expect(await consentRowsFor(email)).toEqual([]);
    });

    it("021 EARS-7.1: every granted purpose gets exactly one dated, versioned record", async () => {
      const email = uniqueEmail("one-row-each");
      const before = new Date();

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: [
            { purpose: PARTNER_DATA_SHARING_PURPOSE, version: "2026-09" },
            { purpose: MARKETING_COMMUNICATIONS_PURPOSE, version: "2026-09" },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const after = new Date();

      const rows = await consentRowsFor(email);
      // One row per purpose — a duplicate would make "the granted version"
      // ambiguous for the manager view of feature 037.
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((row) => row.purpose)).size).toBe(3);
      for (const row of rows) {
        // ADR-0009 §2.1: a consent without a version is not a consent record.
        expect(String(row.version).length).toBeGreaterThan(0);
        // "with its date" — captured at write time, not backfilled.
        const capturedAt = new Date(row.captured_at as string).getTime();
        expect(capturedAt).toBeGreaterThanOrEqual(before.getTime() - 1000);
        expect(capturedAt).toBeLessThanOrEqual(after.getTime() + 1000);
      }
    });

    it("021 EARS-7.2: the marketing row carries the server's wording version, never the caller's claim", async () => {
      const email = uniqueEmail("marketing-version");

      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: {
          email,
          password: PASSWORD,
          medicalWorkerDeclaration: true,
          consent: [
            {
              purpose: PARTNER_DATA_SHARING_PURPOSE,
              version: "attacker-chosen",
            },
            {
              purpose: MARKETING_COMMUNICATIONS_PURPOSE,
              version: "attacker-chosen",
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      // Presence in the payload is the GRANT; the version is the server's,
      // because a row may only ever claim wording this surface rendered.
      expect(
        (await consentRowsFor(email)).map((row) => ({
          purpose: row.purpose,
          version: row.version,
        })),
      ).toEqual([
        {
          purpose: MARKETING_COMMUNICATIONS_PURPOSE,
          version: MARKETING_COMMUNICATIONS_VERSION,
        },
        {
          purpose: MEDICAL_WORKER_DECLARATION_PURPOSE,
          version: MEDICAL_WORKER_DECLARATION_VERSION,
        },
        {
          purpose: PARTNER_DATA_SHARING_PURPOSE,
          version: PARTNER_DATA_SHARING_VERSION,
        },
      ]);
    });
  },
);

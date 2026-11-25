import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  ApplicationProblemCodes,
  ApplicationRefusalSchema,
  BotProtectionErrorCodes,
  PARTNERSHIP_CONSENT_PURPOSE,
  PARTNERSHIP_CONSENT_VERSION_TAG,
  PartnershipRequestIntakeResultSchema,
} from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import { IDP_CLIENT } from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { FakeMailer } from "../../src/mailer/mailer.fake.js";
import { MAILER } from "../../src/mailer/mailer.types.js";
import {
  BOT_PROTECTION,
  type BotProtection,
  type BotProtectionResult,
} from "../../src/bot-protection/index.js";
import { ApplicationsService } from "../../src/applications/applications.service.js";
import { PartnershipRecordsImport } from "../../src/applications/import-partnership-records.js";
import { withSignInHost } from "../setup/storefront-harness.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";

/**
 * 033 EARS-18, EARS-19 — the partnership kind of the application queue
 * (#4032): the public intake through the REAL route on the REAL module with
 * its bot protection, idempotency and consent stamp; the one-off import of the
 * interim form's stored records against real rows.
 *
 * Runs against the dev-stand Postgres; skips when DATABASE_URL or IDP_ISSUER
 * is absent so the shared CI unit job stays green.
 */

class StubBotProtection implements BotProtection {
  static readonly GOOD = "good-captcha";
  verify(token: string): Promise<BotProtectionResult> {
    if (!token) return Promise.resolve({ ok: false, reason: "missing-token" });
    return Promise.resolve(
      token === StubBotProtection.GOOD
        ? { ok: true }
        : { ok: false, reason: "rejected" },
    );
  }
}

const URL = "/v1/public/applications/partnership";
const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "033 EARS-18, EARS-19 — partnership intake and the interim import (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    const created: string[] = [];
    const dirs: string[] = [];
    const mailer = new FakeMailer();

    const tag = () => Math.random().toString(36).slice(2, 10);

    const body = (over: Record<string, unknown> = {}) => ({
      name: "Анна Петрова",
      companyOrClinic: "Клиника «Здоровье»",
      contact: `partner-${tag()}@company.test`,
      role: "Партнёр",
      consentVersion: PARTNERSHIP_CONSENT_VERSION_TAG,
      ...over,
    });

    const submit = (
      payload: unknown,
      key: string | null = randomUUID(),
      token: string | null = StubBotProtection.GOOD,
    ) =>
      app.inject({
        method: "POST",
        url: URL,
        headers: {
          ...(key === null ? {} : { "idempotency-key": key }),
          ...(token === null ? {} : { "x-smartcaptcha-token": token }),
        },
        payload: payload as Record<string, unknown>,
      });

    const codes = (res: { json: () => unknown }) =>
      ApplicationRefusalSchema.parse(res.json()).problems;

    async function row(id: string) {
      const { rows } = await pool.query<{
        kind: string;
        status: string;
        applicant_user_id: string | null;
        payload: unknown;
        contact: unknown;
        subject_line: string | null;
        consent_record_id: string | null;
        consent_purpose: string;
        consent_version_tag: string;
        legacy_record_id: string | null;
        submitted_at: Date;
        team_notice: string;
        receipt_notice: string;
        outcome: string | null;
      }>("SELECT * FROM applications WHERE id = $1", [id]);
      return rows[0]!;
    }

    async function countByContact(contact: string): Promise<number> {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM applications
          WHERE kind = 'partnership' AND contact->>'emailOrTelegram' = $1`,
        [contact],
      );
      return Number(rows[0]!.n);
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await withSignInHost(
        Test.createTestingModule({ imports: [AppModule] })
          .overrideProvider(IDP_CLIENT)
          .useValue(new FakeIdpClient(mailer))
          .overrideProvider(MAILER)
          .useValue(mailer)
          .overrideProvider(RATE_LIMIT_THRESHOLDS)
          .useValue(RELAXED_RATE_LIMIT)
          .overrideProvider(BOT_PROTECTION)
          .useValue(new StubBotProtection()),
      ).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
    });

    afterAll(async () => {
      if (pool && created.length > 0)
        await pool.query(
          "DELETE FROM applications WHERE id = ANY($1::uuid[])",
          [created],
        );
      for (const dir of dirs) await rm(dir, { recursive: true, force: true });
      await app?.close();
    });

    // ------------------------------------------------------------ EARS-18

    it("EARS-18: when a guest posts a valid partnership request with a proof and a key, system shall store one partnership row with its contact and consent and answer 201 { id }; a replay answers the same id and stores nothing more", async () => {
      const key = randomUUID();
      const sent = body();

      const first = await submit(sent, key);
      expect(first.statusCode, first.payload).toBe(201);
      const { id } = PartnershipRequestIntakeResultSchema.parse(first.json());
      created.push(id);

      expect(await row(id)).toMatchObject({
        kind: "partnership",
        status: "new",
        applicant_user_id: null,
        consent_record_id: null,
        payload: {
          name: "Анна Петрова",
          companyOrClinic: "Клиника «Здоровье»",
          role: "Партнёр",
        },
        contact: { emailOrTelegram: sent.contact },
        subject_line: "Клиника «Здоровье»",
        consent_purpose: PARTNERSHIP_CONSENT_PURPOSE,
        consent_version_tag: PARTNERSHIP_CONSENT_VERSION_TAG,
        legacy_record_id: null,
        receipt_notice: "not_applicable",
      });

      const replay = await submit(sent, key);
      expect(replay.statusCode, replay.payload).toBe(201);
      expect(PartnershipRequestIntakeResultSchema.parse(replay.json())).toEqual(
        { id },
      );
      expect(await countByContact(sent.contact)).toBe(1);

      const reused = await submit({ ...sent, name: "Другое имя" }, key);
      expect(reused.statusCode).toBe(422);
      expect(codes(reused)).toEqual([
        { code: ApplicationProblemCodes.idempotencyKeyReused },
      ]);
      expect(await countByContact(sent.contact)).toBe(1);
    });

    it("EARS-18: an empty company is stored absent and the name is the subject line; a Telegram handle is a valid contact", async () => {
      const handle = `@partner_${tag()}`;
      const res = await submit(body({ companyOrClinic: "", contact: handle }));
      expect(res.statusCode, res.payload).toBe(201);
      const { id } = PartnershipRequestIntakeResultSchema.parse(res.json());
      created.push(id);
      const r = await row(id);
      expect(r.payload).toEqual({ name: "Анна Петрова", role: "Партнёр" });
      expect(r.subject_line).toBe("Анна Петрова");
      expect(r.contact).toEqual({ emailOrTelegram: handle });
    });

    it("EARS-18: a missing or rejected proof is refused with the 003 codes, a missing or non-canonical key 428 / 400, a field-invalid body or another consent tag 400 — and nothing is stored", async () => {
      const sent = body();

      const missing = await submit(sent, randomUUID(), null);
      expect(missing.statusCode).toBe(403);
      expect(missing.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.required,
      );
      const rejected = await submit(sent, randomUUID(), "forged");
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json<{ code?: string }>().code).toBe(
        BotProtectionErrorCodes.rejected,
      );

      expect((await submit(sent, null)).statusCode).toBe(428);
      expect((await submit(sent, "not-a-uuid")).statusCode).toBe(400);

      expect(
        (await submit({ ...sent, contact: "not a contact" })).statusCode,
      ).toBe(400);
      expect((await submit({ ...sent, role: "Директор" })).statusCode).toBe(
        400,
      );
      expect((await submit({ ...sent, name: "   " })).statusCode).toBe(400);
      expect((await submit({ ...sent, extra: "x" })).statusCode).toBe(400);

      const stale = await submit({
        ...sent,
        consentVersion: "academy-partnership-v0",
      });
      expect(stale.statusCode).toBe(400);
      expect(codes(stale)).toEqual([
        { code: ApplicationProblemCodes.consentVersionStale, field: "consent" },
      ]);

      expect(await countByContact(sent.contact)).toBe(0);
    });

    // ------------------------------------------------------------ EARS-19

    function record(
      id: string,
      acceptedAt: string,
      over: Record<string, unknown> = {},
    ) {
      return {
        id,
        acceptedAt,
        idempotencyKey: id,
        name: "Иван Сидоров",
        companyOrClinic: "ООО «Фарма»",
        contact: `imported-${tag()}@pharma.test`,
        role: "Компания",
        consent: {
          purpose: PARTNERSHIP_CONSENT_PURPOSE,
          versionTag: PARTNERSHIP_CONSENT_VERSION_TAG,
          text: "Согласен(а) на обработку персональных данных в соответствии со 152-ФЗ.",
          textSha256: "0".repeat(64),
          policyUrl: "https://doctor.school/index/privacy-pay",
          accepted: true,
          acceptedAt,
        },
        ...over,
      };
    }

    async function idsOfLegacy(ids: string[]) {
      const { rows } = await pool.query<{
        id: string;
        legacy_record_id: string;
      }>(
        "SELECT id, legacy_record_id FROM applications WHERE legacy_record_id = ANY($1::uuid[])",
        [ids],
      );
      return rows;
    }

    it("EARS-19: when the operator runs the partnership import, system shall store every valid record once keyed by its own id with its submission time and consent, report imported / already present / invalid, mark the rows imported so no team notice goes out, and a re-run imports nothing", async () => {
      const dir = await mkdtemp(join(tmpdir(), "partnership-import-"));
      dirs.push(dir);
      const old = new Date(Date.now() - 400 * DAY).toISOString();
      const recent = new Date(Date.now() - 3 * DAY).toISOString();
      const a = randomUUID();
      const b = randomUUID();
      const valid = [
        record(a, old),
        record(b, recent, {
          companyOrClinic: undefined,
          contact: `@imported_${tag()}`,
        }),
      ];
      for (const r of valid)
        await writeFile(join(dir, `${r.id}.json`), `${JSON.stringify(r)}\n`);

      const broken = `${randomUUID()}.json`;
      await writeFile(join(dir, broken), "{not json");
      const badRole = randomUUID();
      await writeFile(
        join(dir, `${badRole}.json`),
        JSON.stringify(record(badRole, recent, { role: "Директор" })),
      );
      const misnamed = `${randomUUID()}.json`;
      await writeFile(
        join(dir, misnamed),
        JSON.stringify(record(randomUUID(), recent)),
      );
      const noConsent = randomUUID();
      await writeFile(
        join(dir, `${noConsent}.json`),
        JSON.stringify(
          record(noConsent, recent, { consent: { accepted: false } }),
        ),
      );
      // A staging leftover of the interim store is not a record.
      await writeFile(join(dir, `.${randomUUID()}.${randomUUID()}.tmp`), "{}");

      const importer = app.get(PartnershipRecordsImport);
      const report = await importer.run(dir);
      const rows = await idsOfLegacy([a, b]);
      created.push(...rows.map((r) => r.id));

      expect(report).toEqual({
        imported: 2,
        alreadyPresent: 0,
        invalid: [
          broken,
          misnamed,
          `${badRole}.json`,
          `${noConsent}.json`,
        ].sort(),
      });
      expect(rows).toHaveLength(2);
      expect(await idsOfLegacy([badRole, noConsent])).toHaveLength(0);

      const first = await row(rows.find((r) => r.legacy_record_id === a)!.id);
      expect(first).toMatchObject({
        kind: "partnership",
        status: "new",
        applicant_user_id: null,
        payload: {
          name: "Иван Сидоров",
          companyOrClinic: "ООО «Фарма»",
          role: "Компания",
        },
        contact: { emailOrTelegram: valid[0]!.contact },
        subject_line: "ООО «Фарма»",
        consent_purpose: PARTNERSHIP_CONSENT_PURPOSE,
        consent_version_tag: PARTNERSHIP_CONSENT_VERSION_TAG,
        team_notice: "imported",
        receipt_notice: "not_applicable",
      });
      expect(first.submitted_at.toISOString()).toBe(old);
      const second = await row(rows.find((r) => r.legacy_record_id === b)!.id);
      expect(second.payload).toEqual({
        name: "Иван Сидоров",
        role: "Компания",
      });
      expect(second.subject_line).toBe("Иван Сидоров");

      const again = await importer.run(dir);
      expect(again).toEqual({
        imported: 0,
        alreadyPresent: 2,
        invalid: report.invalid,
      });
      expect(await idsOfLegacy([a, b])).toHaveLength(2);
    });

    it("EARS-19: an imported row falls under the EARS-23 expiry clock from its original submission time", async () => {
      const dir = await mkdtemp(join(tmpdir(), "partnership-import-"));
      dirs.push(dir);
      const id = randomUUID();
      const old = new Date(Date.now() - 367 * DAY).toISOString();
      await writeFile(join(dir, `${id}.json`), JSON.stringify(record(id, old)));

      await app.get(PartnershipRecordsImport).run(dir);
      const [imported] = await idsOfLegacy([id]);
      created.push(imported!.id);

      await app.get(ApplicationsService).expireStale();
      expect(await row(imported!.id)).toMatchObject({
        status: "closed",
        outcome: "expired",
      });
    });

    it("EARS-19: the import of a missing directory fails without writing", async () => {
      await expect(
        app
          .get(PartnershipRecordsImport)
          .run(join(tmpdir(), `absent-${randomUUID()}`)),
      ).rejects.toThrow();
    });
  },
);

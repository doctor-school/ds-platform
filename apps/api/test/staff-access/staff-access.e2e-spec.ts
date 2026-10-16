import { randomUUID } from "node:crypto";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { VersioningType } from "@nestjs/common";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type pg from "pg";
import { AppModule } from "../../src/app.module.js";
import {
  SESSION_STORE,
  type SessionStore,
} from "../../src/auth/session/session.types.js";
import { DRIZZLE_POOL } from "../../src/database/database.tokens.js";
import {
  IDP_CLIENT,
  IdpUnavailableError,
} from "../../src/auth/idp/idp.types.js";
import { FakeIdpClient } from "../../src/auth/idp/idp.fake.js";
import { TOTP_STEP_SECONDS, totpCode } from "../../src/auth/idp/totp.js";
import {
  ADMIN_CSRF_COOKIE_NAME,
  ADMIN_CSRF_HEADER,
  ADMIN_PENDING_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from "../../src/auth/admin-session/admin-session.cookie.js";
import {
  ADMIN_SESSION_STORE,
  PENDING_AUTH_STORE,
  type AdminSessionStore,
  type PendingAuthStore,
} from "../../src/auth/admin-session/admin-session.types.js";
import { STEP_UP_URL } from "../../src/authz/authz.types.js";
import { collectAuthzRows } from "../../src/authz/authz.discovery.js";
import { StaffAccessRepository } from "../../src/staff-access/staff-access.repository.js";
import { SessionService } from "../../src/auth/session/session.service.js";
import { AdminSessionService } from "../../src/auth/admin-session/admin-session.service.js";
import {
  RATE_LIMIT_THRESHOLDS,
  RELAXED_RATE_LIMIT,
} from "../setup/rate-limit.js";
import { ADMIN_DEVICE } from "../setup/admin-session.js";
import {
  deleteEventFixture,
  deleteUserFixture,
} from "../setup/fixture-cleanup.js";
import { eventClassificationSql } from "../setup/event-classification.js";

const LIST_URL = "/v1/admin/staff-access";
const GRANTS_URL = "/v1/admin/staff-access/grants";
const GRANT_ENDPOINT = "POST /v1/admin/staff-access/grants";
const REVERIFY_URL = "/v1/admin/auth/mfa/reverify";
const REVOCATIONS_URL = "/v1/admin/staff-access/revocations";
const REVOKE_ENDPOINT = "POST /v1/admin/staff-access/revocations";
const DOCTOR_GUEST = "doctor_guest";
const STALE_MS = 31 * 60 * 1000;

interface Operator {
  email: string;
  sub: string;
  secret: string;
  sid: string;
  headers: Record<string, string>;
}

interface LedgerRow {
  event_type: string;
  subject_id: string | null;
  metadata: Record<string, unknown>;
}

/**
 * 047 V-1…V-4, V-6, V-7 (grant half) — «Доступы»: the staff-access list, the
 * grant cascade and the step-up re-verification, end to end over the real
 * AppModule against Postgres, with the IdP fake standing in for Zitadel.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  "047 staff access — list, grant, step-up (e2e)",
  () => {
    let app: NestFastifyApplication;
    let pool: pg.Pool;
    let fake: FakeIdpClient;
    const consent = [{ purpose: "tos", version: "2026-01" }];
    const password = "Aa1!ufficiently-long-pw";
    const createdEmails: string[] = [];
    const createdEvents: string[] = [];

    function uniqueEmail(prefix: string): string {
      const email = `s047${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ds.test`;
      createdEmails.push(email);
      return email;
    }

    async function dbNow(): Promise<Date> {
      const { rows } = await pool.query<{ t: Date }>("SELECT now() AS t");
      return rows[0]!.t;
    }

    async function insertEvent(title: string): Promise<string> {
      const id = randomUUID();
      createdEvents.push(id);
      await pool.query(
        `INSERT INTO events
           (id, slug, title, school, starts_at, duration_min, description,
            specialties, partner_ref, program_pdf_ref, state,
            participation_format, kind_id, audience)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offline', ${eventClassificationSql()})`,
        [
          id,
          `s047-${id.slice(0, 8)}`,
          title,
          "Конгресс",
          "2027-04-23T09:00:00.000Z",
          480,
          "Конгресс.",
          ["cardiology"],
          "sponsor:congress",
          null,
          "published",
        ],
      );
      return id;
    }

    async function subOf(email: string): Promise<string> {
      const { rows } = await pool.query<{ zitadel_sub: string }>(
        "SELECT zitadel_sub FROM users WHERE email = $1",
        [email],
      );
      return rows[0]!.zitadel_sub;
    }

    /** A doctor registered through the portal: password + `doctor_guest`. */
    async function registeredDoctor(prefix: string): Promise<{
      email: string;
      sub: string;
    }> {
      const email = uniqueEmail(prefix);
      const reg = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email, password, consent },
      });
      expect(reg.statusCode).toBe(200);
      return { email, sub: await subOf(email) };
    }

    function pendingHeaders(ref: string): Record<string, string> {
      return { ...ADMIN_DEVICE, cookie: `${ADMIN_PENDING_COOKIE_NAME}=${ref}` };
    }

    /** An enrolled staff member holding `role`, with a live admin session. */
    async function enrolledStaff(
      prefix: string,
      role: string,
    ): Promise<Operator> {
      const { email, sub } = await registeredDoctor(prefix);
      await fake.grantProjectRole(sub, role);
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: email, password },
      });
      expect(login.statusCode).toBe(200);
      const ref = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      const start = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/start",
        headers: pendingHeaders(ref),
        payload: {},
      });
      expect(start.statusCode).toBe(200);
      const secret = (start.json() as { secret: string }).secret;
      const verified = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/mfa/enroll/verify",
        headers: pendingHeaders(ref),
        payload: { code: totpCode(secret) },
      });
      expect(verified.statusCode).toBe(200);
      const sid = verified.cookies.find(
        (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
      )!.value;
      const csrf = verified.cookies.find(
        (c) => c.name === ADMIN_CSRF_COOKIE_NAME,
      )!.value;
      return {
        email,
        sub,
        secret,
        sid,
        headers: {
          ...ADMIN_DEVICE,
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sid}; ${ADMIN_CSRF_COOKIE_NAME}=${csrf}`,
          [ADMIN_CSRF_HEADER]: csrf,
        },
      };
    }

    function nextWindowCode(secret: string): string {
      return totpCode(secret, Date.now() + TOTP_STEP_SECONDS * 1000);
    }

    async function ageSecondFactor(
      sid: string,
      byMs = STALE_MS,
    ): Promise<void> {
      const store = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);
      const record = (await store.get(sid))!;
      await store.create({ ...record, mfaVerifiedAtMs: Date.now() - byMs });
    }

    function grant(op: Operator, body: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: GRANTS_URL,
        headers: op.headers,
        payload: body,
      });
    }

    async function roleRows(sub: string, since: Date): Promise<LedgerRow[]> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT event_type, subject_id, metadata FROM audit_ledger
          WHERE subject_id = $1 AND created_at >= $2 AND event_type LIKE 'auth.role.%'
          ORDER BY created_at ASC`,
        [sub, since],
      );
      return rows;
    }

    async function stepUpRows(sub: string, since: Date): Promise<LedgerRow[]> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT event_type, subject_id, metadata FROM audit_ledger
          WHERE subject_id = $1 AND created_at >= $2 AND event_type LIKE 'auth.step_up.%'
          ORDER BY created_at ASC`,
        [sub, since],
      );
      return rows;
    }

    async function bindingsOf(
      email: string,
    ): Promise<Array<{ id: string; role: string; event_id: string }>> {
      const { rows } = await pool.query<{
        id: string;
        role: string;
        event_id: string;
      }>(
        `SELECT g.id, g.role, g.event_id FROM event_role_grants g
           JOIN users u ON u.id = g.user_id WHERE u.email = $1
          ORDER BY g.created_at`,
        [email],
      );
      return rows;
    }

    /** Spies on every IdP write a grant can make. */
    function idpWriteSpies() {
      return [
        vi.spyOn(fake, "createUser"),
        vi.spyOn(fake, "grantProjectRole"),
        vi.spyOn(fake, "updateProjectGrantRoles"),
        vi.spyOn(fake, "setUserPassword"),
      ];
    }

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(RATE_LIMIT_THRESHOLDS)
        .useValue(RELAXED_RATE_LIMIT)
        .overrideProvider(IDP_CLIENT)
        .useValue(new FakeIdpClient())
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = app.get<pg.Pool>(DRIZZLE_POOL);
      fake = app.get<FakeIdpClient>(IDP_CLIENT);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      for (const email of createdEmails.splice(0))
        await deleteUserFixture(pool, "email", email);
      for (const id of createdEvents.splice(0))
        await deleteEventFixture(pool, id);
    });

    afterAll(async () => {
      await app?.close();
    });

    // ---- V-1 -------------------------------------------------------------

    it("047 EARS-1: the staff-access routes are platform_admin-only with live revalidation, and the grant declares stepUp", () => {
      const rows = collectAuthzRows(app).rows;
      const list = rows.find((r) => r.endpoint === `GET ${LIST_URL}`);
      const grants = rows.find((r) => r.endpoint === GRANT_ENDPOINT);
      expect(list?.meta).toMatchObject({
        roles: ["platform_admin"],
        revalidate: "live",
      });
      expect(list?.meta.stepUp).toBeFalsy();
      expect(grants?.meta).toMatchObject({
        roles: ["platform_admin"],
        revalidate: "live",
        stepUp: true,
        audit: "high-stakes",
      });
    });

    it("047 EARS-1: a registrar and a committee member are refused on every staff-access endpoint", async () => {
      const registrar = await enrolledStaff("reg", "event-registrar");
      const committee = await enrolledStaff("pc", "congress-program-committee");
      const spies = idpWriteSpies();
      for (const op of [registrar, committee]) {
        const list = await app.inject({
          method: "GET",
          url: LIST_URL,
          headers: op.headers,
        });
        expect(list.statusCode).toBe(403);
        const res = await grant(op, {
          email: uniqueEmail("never"),
          fullName: "Иванов Иван",
          role: "platform_admin",
        });
        expect(res.statusCode).toBe(403);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    // ---- V-4, V-7, EARS-2 ------------------------------------------------

    it("047 EARS-5: an unknown email gets a verified staff account, a doctor_guest + role grant and a users row, no consent row, and a one-time password the audit and logs never carry", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — новый");
      const email = uniqueEmail("new");
      const since = await dbNow();
      const output: string[] = [];
      const capture = (chunk: unknown): boolean => {
        output.push(String(chunk));
        return true;
      };
      vi.spyOn(process.stdout, "write").mockImplementation(capture);
      vi.spyOn(process.stderr, "write").mockImplementation(capture);

      const res = await grant(admin, {
        email,
        fullName: "Петрова  Анна Сергеевна",
        role: "congress-program-committee",
        eventId,
      });
      vi.mocked(process.stdout.write).mockRestore();
      vi.mocked(process.stderr.write).mockRestore();

      expect(res.statusCode).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = res.json() as {
        row: Record<string, unknown>;
        temporaryPassword?: string;
      };
      const temp = body.temporaryPassword!;
      expect(temp).toHaveLength(16);
      const sub = await subOf(email);
      expect(body.row).toEqual({
        userId: sub,
        fullName: "Петрова Анна Сергеевна",
        email,
        role: "congress-program-committee",
        eventId,
        eventTitle: "Конгресс 047 — новый",
      });

      // The IdP account: verified email, the ФИО name, doctor_guest + the role.
      expect(fake.grantedRoles(sub).sort()).toEqual(
        ["congress-program-committee", "doctor_guest"].sort(),
      );
      expect(await fake.userHasPassword(sub)).toBe(true);
      const session = await fake.passwordLogin(email, temp);
      expect(session).not.toBeNull();

      const { rows: users } = await pool.query<{
        display_name: string;
        email_verified: boolean;
        role: string;
      }>(
        "SELECT display_name, email_verified, role FROM users WHERE zitadel_sub = $1",
        [sub],
      );
      expect(users[0]).toEqual({
        display_name: "Петрова Анна Сергеевна",
        email_verified: true,
        role: "congress-program-committee",
      });
      const { rows: consents } = await pool.query(
        "SELECT 1 FROM consent_records c JOIN users u ON u.id = c.user_id WHERE u.zitadel_sub = $1",
        [sub],
      );
      expect(consents).toHaveLength(0);
      expect((await bindingsOf(email)).map((b) => b.event_id)).toEqual([
        eventId,
      ]);

      // EARS-9: one auth.role.granted with person, role, event and actor.
      const granted = await roleRows(sub, since);
      expect(granted).toHaveLength(1);
      expect(granted[0]!.event_type).toBe("auth.role.granted");
      expect(granted[0]!.metadata).toEqual({
        role: "congress-program-committee",
        by_admin: admin.sub,
        event_id: eventId,
        tier: "admin",
      });

      // The password exists only in the 201 body.
      const { rows: leaked } = await pool.query(
        "SELECT 1 FROM audit_ledger WHERE created_at >= $1 AND metadata::text LIKE $2",
        [since, `%${temp}%`],
      );
      expect(leaked).toHaveLength(0);
      expect(output.join("")).not.toContain(temp);
    });

    it("047 EARS-9: the binding row's 010 change audit carries the granting administrator as actor", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — аудит");
      const email = uniqueEmail("audit");
      const res = await grant(admin, {
        email,
        fullName: "Сидоров Пётр",
        role: "event-registrar",
        eventId,
      });
      expect(res.statusCode).toBe(201);
      const [binding] = await bindingsOf(email);
      const { rows } = await pool.query<{
        subject_id: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT subject_id, metadata FROM audit_ledger
          WHERE event_type = 'data.event_role_grants.insert'
            AND metadata -> 'pk' ->> 'id' = $1`,
        [binding!.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.subject_id).toBe(admin.sub);
      expect(rows[0]!.metadata.source).toBe("admin-ui");
    });

    it("047 EARS-2: the list shows one row per person, role and event, platform_admin with no event", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventA = await insertEvent("Конгресс 047 — A");
      const eventB = await insertEvent("Конгресс 047 — B");
      const email = uniqueEmail("pc2");
      for (const eventId of [eventA, eventB]) {
        const res = await grant(admin, {
          email,
          fullName: "Кузнецова Мария",
          role: "congress-program-committee",
          eventId,
        });
        expect(res.statusCode).toBe(201);
      }
      const sub = await subOf(email);

      const list = await app.inject({
        method: "GET",
        url: LIST_URL,
        headers: admin.headers,
      });
      expect(list.statusCode).toBe(200);
      const items = (list.json() as { items: Array<Record<string, unknown>> })
        .items;
      expect(items.filter((i) => i.userId === sub)).toEqual(
        expect.arrayContaining([
          {
            userId: sub,
            fullName: "Кузнецова Мария",
            email,
            role: "congress-program-committee",
            eventId: eventA,
            eventTitle: "Конгресс 047 — A",
          },
          {
            userId: sub,
            fullName: "Кузнецова Мария",
            email,
            role: "congress-program-committee",
            eventId: eventB,
            eventTitle: "Конгресс 047 — B",
          },
        ]),
      );
      expect(items.filter((i) => i.userId === sub)).toHaveLength(2);
      expect(items).toContainEqual(
        expect.objectContaining({
          userId: admin.sub,
          role: "platform_admin",
          eventId: null,
          eventTitle: null,
        }),
      );
    });

    // ---- V-3 -------------------------------------------------------------

    it("047 EARS-4: an existing account keeps doctor_guest, its name and its password — the role is added to its grant, no account created, no password returned", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — существующий");
      const doctor = await registeredDoctor("doc");
      await fake.grantProjectRole(doctor.sub, "doctor_guest");
      // The owner proved the mailbox (003 verify): only then is the account
      // «existing» in the EARS-4 sense and its password kept.
      fake.setIdentity(doctor.sub, { emailVerified: true });
      const { rows: before } = await pool.query<{
        display_name: string | null;
      }>("SELECT display_name FROM users WHERE zitadel_sub = $1", [doctor.sub]);
      const create = vi.spyOn(fake, "createUser");
      const createGrant = vi.spyOn(fake, "grantProjectRole");
      const update = vi.spyOn(fake, "updateProjectGrantRoles");
      const setPw = vi.spyOn(fake, "setUserPassword");

      const res = await grant(admin, {
        email: doctor.email.toUpperCase(),
        fullName: "Другое Имя",
        role: "congress-program-committee",
        eventId,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { temporaryPassword?: string };
      expect(body.temporaryPassword).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
      expect(createGrant).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
      expect(setPw).not.toHaveBeenCalled();
      expect(fake.grantedRoles(doctor.sub).sort()).toEqual(
        ["congress-program-committee", "doctor_guest"].sort(),
      );
      expect((await fake.passwordLogin(doctor.email, password)).outcome).toBe(
        "authenticated",
      );
      const { rows: after } = await pool.query<{ display_name: string | null }>(
        "SELECT display_name FROM users WHERE zitadel_sub = $1",
        [doctor.sub],
      );
      expect(after[0]!.display_name).toBe(before[0]!.display_name);
      expect((await bindingsOf(doctor.email)).map((b) => b.event_id)).toEqual([
        eventId,
      ]);
    });

    it("047 EARS-6: an existing account without a password gets a temporary password", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const email = uniqueEmail("nopw");
      // An account with a verified email and no password (an operator-made
      // account, the email-code sign-in only).
      const created = await fake.createUser({
        email,
        credential: "none",
        profile: { givenName: "Ольга", familyName: "Смирнова" },
        emailVerified: true,
      });
      await fake.grantProjectRole(created.sub, "doctor_guest");
      expect(await fake.userHasPassword(created.sub)).toBe(false);

      const res = await grant(admin, {
        email,
        fullName: "Смирнова Ольга",
        role: "platform_admin",
      });
      expect(res.statusCode).toBe(201);
      const temp = (res.json() as { temporaryPassword?: string })
        .temporaryPassword!;
      expect(temp).toHaveLength(16);
      expect((await fake.passwordLogin(email, temp)).outcome).toBe(
        "authenticated",
      );
      expect(fake.grantedRoles(created.sub).sort()).toEqual(
        ["doctor_guest", "platform_admin"].sort(),
      );
    });

    it("047 EARS-3: an existing account whose email is unverified is refused with STAFF_GRANT_EMAIL_UNVERIFIED and nothing changes — not its password, roles, sessions, mirror row or bindings; once its email is verified the same grant adds the role and keeps the password", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent(
        "Конгресс 047 — неподтверждённая почта",
      );
      // Someone registered the staff member's address with a password of their
      // own and never proved the mailbox.
      const unverified = await registeredDoctor("unverified");
      await fake.grantProjectRole(unverified.sub, "doctor_guest");
      expect((await fake.getUser(unverified.sub))!.emailVerified).toBe(false);
      const sessions = app.get<SessionStore>(SESSION_STORE);
      const sid = `unverified-${randomUUID()}`;
      await sessions.create({
        sid,
        zitadelSessionId: "z-unverified",
        sub: unverified.sub,
        roles: ["doctor_guest"],
        mfa: false,
        accessToken: "a",
        refreshToken: "r",
        fingerprint: "f",
        expiresAtMs: Date.now() + 3_600_000,
      });
      const mirrorRow = async () =>
        (
          await pool.query("SELECT * FROM users WHERE zitadel_sub = $1", [
            unverified.sub,
          ])
        ).rows;
      const mirrorBefore = await mirrorRow();
      const since = await dbNow();
      const spies = [
        ...idpWriteSpies(),
        vi.spyOn(fake, "markEmailVerified"),
        vi.spyOn(app.get(SessionService), "revokeAllBeforeVerification"),
        vi.spyOn(app.get(AdminSessionService), "forceLogout"),
      ];
      const body = {
        email: unverified.email,
        fullName: "Сотрудник Настоящий",
        role: "congress-program-committee",
        eventId,
      };

      const refused = await grant(admin, body);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        statusCode: 409,
        errorCode: "STAFF_GRANT_EMAIL_UNVERIFIED",
      });
      expect(refused.json()).not.toHaveProperty("temporaryPassword");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(fake.grantedRoles(unverified.sub)).toEqual(["doctor_guest"]);
      expect((await fake.getUser(unverified.sub))!.emailVerified).toBe(false);
      expect(
        (await fake.passwordLogin(unverified.email, password)).outcome,
      ).toBe("authenticated");
      expect(await sessions.get(sid)).toBeDefined();
      expect(await mirrorRow()).toEqual(mirrorBefore);
      expect(await bindingsOf(unverified.email)).toEqual([]);
      expect(await roleRows(unverified.sub, since)).toHaveLength(0);
      vi.restoreAllMocks();

      // The person proves the mailbox (the email-code sign-in); the
      // administrator repeats the grant, which now takes the verified branch.
      fake.setIdentity(unverified.sub, { emailVerified: true });
      const granted = await grant(admin, body);
      expect(granted.statusCode).toBe(201);
      expect(granted.json()).not.toHaveProperty("temporaryPassword");
      expect(fake.grantedRoles(unverified.sub).sort()).toEqual(
        ["congress-program-committee", "doctor_guest"].sort(),
      );
      expect(
        (await fake.passwordLogin(unverified.email, password)).outcome,
      ).toBe("authenticated");
      expect(
        (await bindingsOf(unverified.email)).map((b) => b.event_id),
      ).toEqual([eventId]);
      expect(
        (await roleRows(unverified.sub, since)).map((r) => r.event_type),
      ).toEqual(["auth.role.granted"]);
    });

    it("047 EARS-3: an email that more than one IdP account holds is refused with STAFF_GRANT_EMAIL_AMBIGUOUS and nothing changes — no IdP write, no binding, no ledger row", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — общая почта");
      const email = uniqueEmail("shared");
      // The IdP does not keep emails unique: two accounts on one address.
      const first = `shared-a-${randomUUID()}`;
      const second = `shared-b-${randomUUID()}`;
      fake.seedUser({ sub: first, email });
      fake.seedUser({ sub: second, email });
      fake.setIdentity(first, { emailVerified: true });
      fake.setIdentity(second, { emailVerified: true });
      const since = await dbNow();
      const spies = [...idpWriteSpies(), vi.spyOn(fake, "markEmailVerified")];

      const refused = await grant(admin, {
        email,
        fullName: "Общая Почта",
        role: "congress-program-committee",
        eventId,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        statusCode: 409,
        errorCode: "STAFF_GRANT_EMAIL_AMBIGUOUS",
      });
      expect(refused.json()).not.toHaveProperty("temporaryPassword");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(fake.grantedRoles(first)).toEqual([]);
      expect(fake.grantedRoles(second)).toEqual([]);
      expect(await bindingsOf(email)).toEqual([]);
      expect(await roleRows(first, since)).toHaveLength(0);
      expect(await roleRows(second, since)).toHaveLength(0);
      vi.restoreAllMocks();
    });

    it("047 EARS-3: two concurrent grants for one email are serialized — one completes, the other is refused as complete, and the shown password signs in", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const email = uniqueEmail("race");
      const body = { email, fullName: "Гонкин Пётр", role: "platform_admin" };
      const create = vi.spyOn(fake, "createUser");

      const answers = await Promise.all([
        grant(admin, body),
        grant(admin, body),
      ]);
      expect(answers.map((a) => a.statusCode).sort()).toEqual([201, 409]);
      expect(create).toHaveBeenCalledTimes(1);
      const temp = (
        answers.find((a) => a.statusCode === 201)!.json() as {
          temporaryPassword?: string;
        }
      ).temporaryPassword!;
      expect((await fake.passwordLogin(email, temp)).outcome).toBe(
        "authenticated",
      );
    });

    // ---- V-2 -------------------------------------------------------------

    it("047 EARS-3: malformed or mis-shaped grants are refused with no IdP write and no row", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — форма");
      const spies = idpWriteSpies();
      const email = uniqueEmail("shape");
      for (const body of [
        { fullName: "Иванов Иван", role: "platform_admin" },
        { email, fullName: "Иванов", role: "platform_admin" },
        { email, fullName: "Иванов Иван", role: "platform_admin", eventId },
        { email, fullName: "Иванов Иван", role: "event-registrar" },
        { email, fullName: "Иванов Иван", role: "pd_officer" },
      ]) {
        const res = await grant(admin, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
      }
      const missing = await grant(admin, {
        email,
        fullName: "Иванов Иван",
        role: "event-registrar",
        eventId: randomUUID(),
      });
      expect(missing.statusCode).toBe(422);
      expect((missing.json() as { errorCode: string }).errorCode).toBe(
        "EVENT_NOT_FOUND",
      );
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      const { rows } = await pool.query(
        "SELECT 1 FROM users WHERE email = $1",
        [email],
      );
      expect(rows).toHaveLength(0);
    });

    it("047 EARS-3: a registrar already bound to another event, a complete role and a complete committee event are refused with nothing changed", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventA = await insertEvent("Конгресс 047 — R1");
      const eventB = await insertEvent("Конгресс 047 — R2");
      const registrar = uniqueEmail("r");
      const committee = uniqueEmail("c");
      const pa = uniqueEmail("p");
      expect(
        (
          await grant(admin, {
            email: registrar,
            fullName: "Регистратор Один",
            role: "event-registrar",
            eventId: eventA,
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await grant(admin, {
            email: committee,
            fullName: "Комитет Один",
            role: "congress-program-committee",
            eventId: eventA,
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await grant(admin, {
            email: pa,
            fullName: "Админ Один",
            role: "platform_admin",
          })
        ).statusCode,
      ).toBe(201);

      const spies = idpWriteSpies();
      const since = await dbNow();
      const cases: Array<[Record<string, unknown>, number, string]> = [
        [
          {
            email: registrar,
            fullName: "Регистратор Один",
            role: "event-registrar",
            eventId: eventB,
          },
          409,
          "REGISTRAR_BOUND_ELSEWHERE",
        ],
        [
          { email: pa, fullName: "Админ Один", role: "platform_admin" },
          409,
          "GRANT_ALREADY_COMPLETE",
        ],
        [
          {
            email: committee,
            fullName: "Комитет Один",
            role: "congress-program-committee",
            eventId: eventA,
          },
          409,
          "GRANT_ALREADY_COMPLETE",
        ],
      ];
      for (const [body, status, code] of cases) {
        const res = await grant(admin, body);
        expect(res.statusCode, code).toBe(status);
        expect((res.json() as { errorCode: string }).errorCode).toBe(code);
      }
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect((await bindingsOf(registrar)).map((b) => b.event_id)).toEqual([
        eventA,
      ]);
      for (const email of [registrar, committee, pa])
        expect(await roleRows(await subOf(email), since)).toHaveLength(0);

      // A second committee event is NOT a duplicate: it is granted.
      const second = await grant(admin, {
        email: committee,
        fullName: "Комитет Один",
        role: "congress-program-committee",
        eventId: eventB,
      });
      expect(second.statusCode).toBe(201);
    });

    it("047 EARS-3: a registrar binding written past the grant's read (by a writer outside the grant lock) is refused by the database constraint as REGISTRAR_BOUND_ELSEWHERE, with no auth.role.granted", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventA = await insertEvent("Конгресс 047 — гонка A");
      const eventB = await insertEvent("Конгресс 047 — гонка B");
      const registrar = uniqueEmail("regrace");
      expect(
        (
          await grant(admin, {
            email: registrar,
            fullName: "Регистратор Гонка",
            role: "event-registrar",
            eventId: eventA,
          })
        ).statusCode,
      ).toBe(201);
      const since = await dbNow();
      // The completeness read misses the eventA binding, as if it landed
      // between the read and the commit.
      vi.spyOn(
        app.get(StaffAccessRepository),
        "listBindings",
      ).mockResolvedValueOnce([]);

      const res = await grant(admin, {
        email: registrar,
        fullName: "Регистратор Гонка",
        role: "event-registrar",
        eventId: eventB,
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { errorCode: string }).errorCode).toBe(
        "REGISTRAR_BOUND_ELSEWHERE",
      );
      expect((await bindingsOf(registrar)).map((b) => b.event_id)).toEqual([
        eventA,
      ]);
      expect(await roleRows(await subOf(registrar), since)).toHaveLength(0);
    });

    it("047 EARS-3: a platform_admin grant that failed after the IdP role add is finished by the same grant, with one auth.role.granted and the password shown by the finishing request", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const email = uniqueEmail("dbfault");
      const since = await dbNow();
      vi.spyOn(
        app.get(StaffAccessRepository),
        "commitGrant",
      ).mockRejectedValueOnce(new Error("simulated database fault"));
      const body = {
        email,
        fullName: "Новиков Олег",
        role: "platform_admin",
      };

      const failed = await grant(admin, body);
      expect(failed.statusCode).toBe(500);
      const sub = (await fake.findUserByEmail(email))!;
      expect(fake.grantedRoles(sub)).toContain("platform_admin");
      expect(await roleRows(sub, since)).toHaveLength(0);
      expect(await fake.userHasPassword(sub)).toBe(false);

      const finished = await grant(admin, body);
      expect(finished.statusCode).toBe(201);
      const temp = (finished.json() as { temporaryPassword?: string })
        .temporaryPassword!;
      expect((await fake.passwordLogin(email, temp)).outcome).toBe(
        "authenticated",
      );
      expect((await roleRows(sub, since)).map((r) => r.event_type)).toEqual([
        "auth.role.granted",
      ]);

      const again = await grant(admin, body);
      expect(again.statusCode).toBe(409);
    });

    it("047 EARS-6: a grant that failed at the password step is finished by the same grant, which sets and shows the password, with one auth.role.granted", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const email = uniqueEmail("pwfault");
      const since = await dbNow();
      vi.spyOn(fake, "setUserPassword").mockRejectedValueOnce(
        new IdpUnavailableError("simulated set-password outage"),
      );
      const body = {
        email,
        fullName: "Морозов Илья",
        role: "platform_admin",
      };

      const failed = await grant(admin, body);
      expect(failed.statusCode).toBe(503);
      const sub = (await fake.findUserByEmail(email))!;
      expect(await fake.userHasPassword(sub)).toBe(false);

      const finished = await grant(admin, body);
      expect(finished.statusCode).toBe(201);
      const temp = (finished.json() as { temporaryPassword?: string })
        .temporaryPassword!;
      expect((await fake.passwordLogin(email, temp)).outcome).toBe(
        "authenticated",
      );
      expect((await roleRows(sub, since)).map((r) => r.event_type)).toEqual([
        "auth.role.granted",
      ]);
    });

    // ---- V-6 -------------------------------------------------------------

    it("047 EARS-8: a stale second factor is refused with STEP_UP_REQUIRED and nothing changes; re-verify refreshes the same session and the same grant passes; a second grant inside the window asks for no code", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      await ageSecondFactor(admin.sid);
      const store = app.get<AdminSessionStore>(ADMIN_SESSION_STORE);
      const before = (await store.get(admin.sid))!;
      const email = uniqueEmail("stepup");
      const since = await dbNow();
      const spies = idpWriteSpies();
      const body = { email, fullName: "Волков Антон", role: "platform_admin" };

      const refused = await grant(admin, body);
      expect(refused.statusCode).toBe(401);
      const problem = refused.json() as {
        errorCode: string;
        stepUpUrl: string;
      };
      expect(problem.errorCode).toBe("STEP_UP_REQUIRED");
      expect(problem.stepUpUrl).toBe(STEP_UP_URL);
      expect(STEP_UP_URL).toBe("/mfa/challenge?mode=reverify");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(await fake.findUserByEmail(email)).toBeNull();

      // Not a step-up route → 400 before any code check.
      const wrongEndpoint = await app.inject({
        method: "POST",
        url: REVERIFY_URL,
        headers: admin.headers,
        payload: {
          code: nextWindowCode(admin.secret),
          endpoint: "GET /v1/admin/staff-access",
        },
      });
      expect(wrongEndpoint.statusCode).toBe(400);

      const wrongCode = await app.inject({
        method: "POST",
        url: REVERIFY_URL,
        headers: admin.headers,
        payload: { code: "000000", endpoint: GRANT_ENDPOINT },
      });
      expect(wrongCode.statusCode).toBe(401);
      expect((await store.get(admin.sid))!.mfaVerifiedAtMs).toBe(
        before.mfaVerifiedAtMs,
      );

      const accepted = await app.inject({
        method: "POST",
        url: REVERIFY_URL,
        headers: admin.headers,
        payload: {
          code: nextWindowCode(admin.secret),
          endpoint: GRANT_ENDPOINT,
        },
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.cookies).toHaveLength(0);
      const after = (await store.get(admin.sid))!;
      expect(after.sid).toBe(before.sid);
      expect(after.expiresAtMs).toBe(before.expiresAtMs);
      expect(Date.now() - after.mfaVerifiedAtMs!).toBeLessThan(60_000);

      const passed = await grant(admin, body);
      expect(passed.statusCode).toBe(201);
      const second = await grant(admin, {
        email: uniqueEmail("stepup2"),
        fullName: "Волкова Анна",
        role: "platform_admin",
      });
      expect(second.statusCode).toBe(201);

      const trail = await stepUpRows(admin.sub, since);
      expect(trail.map((r) => r.event_type)).toEqual([
        "auth.step_up.requested",
        "auth.step_up.failed",
        "auth.step_up.succeeded",
      ]);
      for (const row of trail) {
        expect(row.subject_id).toBe(admin.sub);
        expect(row.metadata).toMatchObject({
          endpoint: GRANT_ENDPOINT,
          mfa_method: "totp",
          ip: "127.0.0.1",
          ua: ADMIN_DEVICE["user-agent"],
          tier: "admin",
        });
      }
      expect(trail[2]!.metadata).toMatchObject({
        acr_before: "mfa-stale",
        acr_after: "mfa-fresh",
      });
      const { rows: failures } = await pool.query(
        `SELECT 1 FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2
           AND event_type = 'auth.mfa.failure' AND metadata ->> 'stage' = 'step_up'`,
        [admin.sub, since],
      );
      expect(failures).toHaveLength(1);
    });

    // ---- V-5, V-6, V-7 (revocation) --------------------------------------

    function revoke(op: Operator, body: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: REVOCATIONS_URL,
        headers: op.headers,
        payload: body,
      });
    }

    /** A staff member with an open admin session AND a pending admin sign-in. */
    async function signedInMember(
      role: string,
    ): Promise<Operator & { pendingRef: string }> {
      const member = await enrolledStaff("pc", role);
      await fake.grantProjectRole(member.sub, DOCTOR_GUEST);
      fake.setIdentity(member.sub, { emailVerified: true });
      const login = await app.inject({
        method: "POST",
        url: "/v1/admin/auth/login",
        headers: ADMIN_DEVICE,
        payload: { identifier: member.email, password },
      });
      expect(login.statusCode).toBe(200);
      const pendingRef = login.cookies.find(
        (c) => c.name === ADMIN_PENDING_COOKIE_NAME,
      )!.value;
      return { ...member, pendingRef };
    }

    async function adminSessionStatus(op: Operator): Promise<number> {
      const res = await app.inject({
        method: "GET",
        url: "/v1/admin/auth/session",
        headers: op.headers,
      });
      return res.statusCode;
    }

    async function pendingRecord(ref: string) {
      return app.get<PendingAuthStore>(PENDING_AUTH_STORE).get(ref);
    }

    async function mirrorRole(sub: string): Promise<string> {
      const { rows } = await pool.query<{ role: string }>(
        "SELECT role FROM users WHERE zitadel_sub = $1",
        [sub],
      );
      return rows[0]!.role;
    }

    it("047 EARS-1: the revocation route is platform_admin-only with live revalidation, stepUp and high-stakes audit", () => {
      const rows = collectAuthzRows(app).rows;
      const revocations = rows.find((r) => r.endpoint === REVOKE_ENDPOINT);
      expect(revocations?.meta).toMatchObject({
        roles: ["platform_admin"],
        revalidate: "live",
        stepUp: true,
        audit: "high-stakes",
      });
    });

    it("047 EARS-7: revoking one of two committee bindings keeps the role; revoking the last removes it and keeps doctor_guest; every admin session and pending sign-in ends each time and the next admin request is refused", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const first = await insertEvent("Конгресс 047 — первый");
      const second = await insertEvent("Конгресс 047 — второй");
      const member = await signedInMember("congress-program-committee");
      for (const eventId of [first, second]) {
        const res = await grant(admin, {
          email: member.email,
          fullName: "Комитетов Иван",
          role: "congress-program-committee",
          eventId,
        });
        expect(res.statusCode).toBe(201);
      }
      expect(await adminSessionStatus(member)).toBe(200);
      const since = await dbNow();

      const one = await revoke(admin, {
        userId: member.sub,
        role: "congress-program-committee",
        eventId: first,
      });
      expect(one.statusCode).toBe(204);
      expect((await bindingsOf(member.email)).map((b) => b.event_id)).toEqual([
        second,
      ]);
      expect(fake.grantedRoles(member.sub).sort()).toEqual(
        ["congress-program-committee", DOCTOR_GUEST].sort(),
      );
      expect(await mirrorRole(member.sub)).toBe("congress-program-committee");
      expect(await adminSessionStatus(member)).toBe(401);
      expect(await pendingRecord(member.pendingRef)).toBeUndefined();
      const { rows: terminated } = await pool.query(
        `SELECT 1 FROM audit_ledger WHERE subject_id = $1 AND created_at >= $2
           AND event_type = 'auth.session.terminated' AND reason = 'force'`,
        [member.sub, since],
      );
      expect(terminated).toHaveLength(1);

      const last = await revoke(admin, {
        userId: member.sub,
        role: "congress-program-committee",
        eventId: second,
      });
      expect(last.statusCode).toBe(204);
      expect(await bindingsOf(member.email)).toEqual([]);
      expect(fake.grantedRoles(member.sub)).toEqual([DOCTOR_GUEST]);
      expect(await mirrorRole(member.sub)).toBe(DOCTOR_GUEST);

      const revoked = await roleRows(member.sub, since);
      expect(revoked.map((r) => r.event_type)).toEqual([
        "auth.role.revoked",
        "auth.role.revoked",
      ]);
      expect(revoked.map((r) => r.metadata.event_id)).toEqual([first, second]);

      // A complete revocation is refused as already revoked, nothing changed.
      const again = await revoke(admin, {
        userId: member.sub,
        role: "congress-program-committee",
        eventId: second,
      });
      expect(again.statusCode).toBe(409);
      expect((again.json() as { errorCode: string }).errorCode).toBe(
        "REVOKE_ALREADY_COMPLETE",
      );
      expect(await roleRows(member.sub, since)).toHaveLength(2);
    });

    it("047 EARS-7: a platform administrator revoking their own platform_admin is refused with nothing changed", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const since = await dbNow();
      const update = vi.spyOn(fake, "updateProjectGrantRoles");
      const res = await revoke(admin, {
        userId: admin.sub,
        role: "platform_admin",
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { errorCode: string }).errorCode).toBe(
        "REVOKE_SELF_PLATFORM_ADMIN",
      );
      expect(update).not.toHaveBeenCalled();
      expect(fake.grantedRoles(admin.sub)).toContain("platform_admin");
      expect(await adminSessionStatus(admin)).toBe(200);
      expect(await roleRows(admin.sub, since)).toEqual([]);
    });

    it("047 EARS-7: another platform administrator's platform_admin is revoked from the grant, doctor_guest kept, sessions ended", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const other = await signedInMember("platform_admin");
      const since = await dbNow();
      const res = await revoke(admin, {
        userId: other.sub,
        role: "platform_admin",
      });
      expect(res.statusCode).toBe(204);
      expect(fake.grantedRoles(other.sub)).toEqual([DOCTOR_GUEST]);
      expect(await adminSessionStatus(other)).toBe(401);
      expect(await pendingRecord(other.pendingRef)).toBeUndefined();
      const revoked = await roleRows(other.sub, since);
      expect(revoked).toHaveLength(1);
      expect(revoked[0]!.metadata).toMatchObject({
        role: "platform_admin",
        by_admin: admin.sub,
      });
      expect(revoked[0]!.metadata.event_id).toBeUndefined();
    });

    it("047 EARS-7: revoking the last role of a grant removes the grant, ends the sessions, records one auth.role.revoked and re-projects the mirror", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      // A grant that predates EARS-4/5: platform_admin alone, no doctor_guest.
      const solo = await enrolledStaff("solo", "platform_admin");
      const soloGrant = await fake.getProjectGrant(solo.sub);
      await fake.updateProjectGrantRoles(solo.sub, soloGrant!.grantId, [
        "platform_admin",
      ]);
      expect(fake.grantedRoles(solo.sub)).toEqual(["platform_admin"]);
      const update = vi.spyOn(fake, "updateProjectGrantRoles");
      const remove = vi.spyOn(fake, "removeProjectGrant");
      const since = await dbNow();

      const res = await revoke(admin, {
        userId: solo.sub,
        role: "platform_admin",
      });
      expect(res.statusCode).toBe(204);
      expect(update).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(await fake.getProjectGrant(solo.sub)).toBeNull();
      expect(await adminSessionStatus(solo)).toBe(401);
      expect(await mirrorRole(solo.sub)).toBe(DOCTOR_GUEST);
      const revoked = await roleRows(solo.sub, since);
      expect(revoked.map((r) => r.event_type)).toEqual(["auth.role.revoked"]);
    });

    it("047 EARS-7: a revocation of a role the person does not hold is refused, nothing written", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — не выдано");
      const member = await signedInMember("congress-program-committee");
      const update = vi.spyOn(fake, "updateProjectGrantRoles");
      const remove = vi.spyOn(fake, "removeProjectGrant");
      const since = await dbNow();

      for (const body of [
        { userId: member.sub, role: "event-registrar", eventId },
        { userId: member.sub, role: "platform_admin" },
      ]) {
        const res = await revoke(admin, body);
        expect(res.statusCode).toBe(409);
        expect((res.json() as { errorCode: string }).errorCode).toBe(
          "REVOKE_ALREADY_COMPLETE",
        );
      }
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(fake.grantedRoles(member.sub).sort()).toEqual(
        ["congress-program-committee", DOCTOR_GUEST].sort(),
      );
      expect(await adminSessionStatus(member)).toBe(200);
      expect(await pendingRecord(member.pendingRef)).toBeDefined();
      expect(await roleRows(member.sub, since)).toEqual([]);
    });

    it("047 EARS-7: an IdP failure on the role removal answers 503, still ends the sessions and pending sign-in, records no revocation, and the repeat finishes it with one auth.role.revoked", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — сбой");
      const member = await signedInMember("congress-program-committee");
      const granted = await grant(admin, {
        email: member.email,
        fullName: "Комитетов Пётр",
        role: "congress-program-committee",
        eventId,
      });
      expect(granted.statusCode).toBe(201);
      const since = await dbNow();
      vi.spyOn(fake, "updateProjectGrantRoles").mockRejectedValueOnce(
        new IdpUnavailableError("simulated grant-update outage"),
      );
      const body = {
        userId: member.sub,
        role: "congress-program-committee",
        eventId,
      };

      const failed = await revoke(admin, body);
      expect(failed.statusCode).toBe(503);
      expect(await adminSessionStatus(member)).toBe(401);
      expect(await pendingRecord(member.pendingRef)).toBeUndefined();
      expect(await roleRows(member.sub, since)).toEqual([]);
      expect(fake.grantedRoles(member.sub)).toContain(
        "congress-program-committee",
      );
      expect(await mirrorRole(member.sub)).toBe("congress-program-committee");
      expect(await bindingsOf(member.email)).toEqual([]);

      const finished = await revoke(admin, body);
      expect(finished.statusCode).toBe(204);
      expect(fake.grantedRoles(member.sub)).toEqual([DOCTOR_GUEST]);
      expect(await mirrorRole(member.sub)).toBe(DOCTOR_GUEST);
      const revoked = await roleRows(member.sub, since);
      expect(revoked).toHaveLength(1);
      expect(revoked[0]!.event_type).toBe("auth.role.revoked");
    });

    it("047 EARS-9: the revocation records auth.role.revoked with person, role, event and actor, and the binding delete carries the administrator as the 010 actor", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — аудит отзыва");
      const email = uniqueEmail("revaudit");
      const granted = await grant(admin, {
        email,
        fullName: "Регистров Олег",
        role: "event-registrar",
        eventId,
      });
      expect(granted.statusCode).toBe(201);
      const [binding] = await bindingsOf(email);
      const sub = await subOf(email);
      const since = await dbNow();

      const res = await revoke(admin, {
        userId: sub,
        role: "event-registrar",
        eventId,
      });
      expect(res.statusCode).toBe(204);
      const revoked = await roleRows(sub, since);
      expect(revoked).toHaveLength(1);
      expect(revoked[0]).toMatchObject({
        event_type: "auth.role.revoked",
        subject_id: sub,
        metadata: {
          role: "event-registrar",
          by_admin: admin.sub,
          event_id: eventId,
          tier: "admin",
        },
      });
      const { rows } = await pool.query<{
        subject_id: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT subject_id, metadata FROM audit_ledger
          WHERE event_type = 'data.event_role_grants.delete'
            AND metadata -> 'pk' ->> 'id' = $1`,
        [binding!.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.subject_id).toBe(admin.sub);
      expect(rows[0]!.metadata.source).toBe("admin-ui");
    });

    it("047 EARS-8: a stale second factor refuses a revocation with STEP_UP_REQUIRED and nothing changes; after a current code the same revocation passes", async () => {
      const admin = await enrolledStaff("adm", "platform_admin");
      const eventId = await insertEvent("Конгресс 047 — свежесть отзыва");
      const member = await signedInMember("congress-program-committee");
      const granted = await grant(admin, {
        email: member.email,
        fullName: "Комитетов Семён",
        role: "congress-program-committee",
        eventId,
      });
      expect(granted.statusCode).toBe(201);
      await ageSecondFactor(admin.sid);
      const since = await dbNow();
      const update = vi.spyOn(fake, "updateProjectGrantRoles");
      const body = {
        userId: member.sub,
        role: "congress-program-committee",
        eventId,
      };

      const refused = await revoke(admin, body);
      expect(refused.statusCode).toBe(401);
      const problem = refused.json() as {
        errorCode: string;
        stepUpUrl: string;
      };
      expect(problem.errorCode).toBe("STEP_UP_REQUIRED");
      expect(problem.stepUpUrl).toBe("/mfa/challenge?mode=reverify");
      expect(update).not.toHaveBeenCalled();
      expect((await bindingsOf(member.email)).map((b) => b.event_id)).toEqual([
        eventId,
      ]);
      expect(await adminSessionStatus(member)).toBe(200);
      expect(await pendingRecord(member.pendingRef)).toBeDefined();
      expect(await roleRows(member.sub, since)).toEqual([]);

      const accepted = await app.inject({
        method: "POST",
        url: REVERIFY_URL,
        headers: admin.headers,
        payload: {
          code: nextWindowCode(admin.secret),
          endpoint: REVOKE_ENDPOINT,
        },
      });
      expect(accepted.statusCode).toBe(200);

      const passed = await revoke(admin, body);
      expect(passed.statusCode).toBe(204);
      expect(await bindingsOf(member.email)).toEqual([]);
      expect(fake.grantedRoles(member.sub)).toEqual([DOCTOR_GUEST]);
      const trail = await stepUpRows(admin.sub, since);
      expect(trail.map((r) => r.event_type)).toEqual([
        "auth.step_up.requested",
        "auth.step_up.succeeded",
      ]);
      for (const row of trail) {
        expect(row.metadata).toMatchObject({ endpoint: REVOKE_ENDPOINT });
      }
    });
  },
);

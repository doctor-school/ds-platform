import { randomUUID } from "node:crypto";
import { VersioningType } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DrizzleHandle } from "@ds/db";
import { doctorSpecialties, users } from "@ds/db";
import { SPECIALTY_OTHER_CODE, SpecialtyChoiceSchema } from "@ds/schemas";
import { AppModule } from "../../src/app.module.js";
import { DRIZZLE_DB } from "../../src/database/database.tokens.js";
import { SpecialtiesService } from "../../src/storefront/specialties.service.js";
import {
  SPECIALTY_CHOICE_COOKIE_NAME,
  readSpecialtyChoiceCookie,
} from "../../src/storefront/specialty-choice.cookie.js";
import { SpecialtyChoiceService } from "../../src/storefront/specialty-choice.service.js";

// 017 EARS-6 (#1482) — choice persistence and the sign-in cascade, over the REAL
// stack: Fastify + Postgres + the boot-time book seed + the 010 audit trigger.
//
// TWO tiers on purpose, and the split is not a convenience:
//
//  • the GUEST contract is exercised over HTTP (`app.inject`), because the whole
//    point of it is what the wire does — the `__Host-` cookie the response sets,
//    the cookie a later request replays, the 422 a non-member draws. None of
//    that is observable from the service.
//  • the DOCTOR contract is exercised against the real service + repository +
//    Postgres. A doctor request needs a live Zitadel-issued session, and
//    building a real-login harness here would be an integration-tier fixture
//    (#1490), while faking one would prove only that the fake accepts what the
//    handler asks it. The write path, the one-primary index, the retire-then-
//    insert history and LD-2's whole cascade all live BELOW the controller, and
//    that is exactly what these cases drive.
//
// No count literal and no specialty NAME literal appears here: entries come from
// the seeded book the read serves.
describe.skipIf(!process.env.DATABASE_URL)(
  "017 EARS-6 specialty choice persistence and the sign-in cascade (e2e)",
  () => {
    let app: NestFastifyApplication;
    let db: DrizzleHandle["db"];
    let choices: SpecialtyChoiceService;
    let specialties: SpecialtiesService;
    const seededDoctorIds: string[] = [];

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
      );
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();

      db = app.get<DrizzleHandle["db"]>(DRIZZLE_DB);
      choices = app.get(SpecialtyChoiceService);
      specialties = app.get(SpecialtiesService);
    }, 60_000);

    afterAll(async () => {
      // Test-owned rows only, by id. The link rows go first: the FK is
      // `RESTRICT`, which is the production invariant and not something a test
      // may work around.
      for (const doctorId of seededDoctorIds) {
        await db
          .delete(doctorSpecialties)
          .where(eq(doctorSpecialties.doctorId, doctorId));
        await db.delete(users).where(eq(users.id, doctorId));
      }
      await app?.close();
    });

    /** Two distinct book entries plus «Другое», taken from what the read serves. */
    async function bookEntries() {
      const book = await specialties.book();
      const other = book.entries.find((e) => e.code === SPECIALTY_OTHER_CODE);
      const nomenclature = book.entries.filter((e) => !e.isOther);
      expect(other).toBeDefined();
      expect(nomenclature.length).toBeGreaterThan(1);
      return { first: nomenclature[0]!, second: nomenclature[1]!, other: other! };
    }

    async function seedDoctor(): Promise<{ id: string; sub: string }> {
      const sub = `ears6-${randomUUID()}`;
      const [row] = await db
        .insert(users)
        .values({ zitadelSub: sub, email: `${sub}@example.test` })
        .returning({ id: users.id });
      seededDoctorIds.push(row!.id);
      return { id: row!.id, sub };
    }

    async function activeLinkRows(doctorId: string) {
      return db
        .select()
        .from(doctorSpecialties)
        .where(
          and(
            eq(doctorSpecialties.doctorId, doctorId),
            eq(doctorSpecialties.status, "active"),
          ),
        );
    }

    function chooseAsGuest(specialty: string, cookie?: string) {
      return app.inject({
        method: "POST",
        url: "/v1/public/specialty-choice",
        payload: { specialty },
        ...(cookie ? { headers: { cookie } } : {}),
      });
    }

    /** The `__Host-ds_specialty` value the response sets, as a `Cookie` header. */
    function cookieFrom(res: { headers: Record<string, unknown> }): string {
      const setCookie = res.headers["set-cookie"];
      const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(typeof raw).toBe("string");
      const [pair] = String(raw).split(";");
      return pair!;
    }

    it("EARS-6.1: a guest's choice is recorded in the anonymous session and reopens the targeted view", async () => {
      const { first } = await bookEntries();

      const chosen = await chooseAsGuest(first.id);
      expect(chosen.statusCode).toBe(200);
      const body = SpecialtyChoiceSchema.parse(chosen.json());
      expect(body.specialty).toEqual(first);
      expect(body.storedIn).toBe("session");

      // The anonymous session is the `__Host-` cookie, with the attribute set
      // that prefix REQUIRES — a browser silently drops it otherwise, and the
      // guest's choice would be forgotten on the next page load.
      const setCookie = String(chosen.headers["set-cookie"]);
      expect(setCookie).toContain(`${SPECIALTY_CHOICE_COOKIE_NAME}=`);
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).not.toContain("Domain=");
      expect(readSpecialtyChoiceCookie(setCookie)).toBe(first.id);

      // The return visit: the same browser, one read, the remembered entry.
      const returning = await app.inject({
        method: "GET",
        url: "/v1/public/specialty-choice",
        headers: { cookie: cookieFrom(chosen) },
      });
      expect(returning.statusCode).toBe(200);
      const remembered = SpecialtyChoiceSchema.parse(returning.json());
      expect(remembered.specialty).toEqual(first);
      expect(remembered.storedIn).toBe("session");
    });

    it("EARS-6.2: a browser that has not chosen is told so, not refused", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/public/specialty-choice",
      });
      expect(res.statusCode).toBe(200);
      expect(SpecialtyChoiceSchema.parse(res.json())).toEqual({
        specialty: null,
        storedIn: "none",
      });
    });

    it("EARS-6.3: re-choosing is idempotent and a re-choice re-targets", async () => {
      const { first, second } = await bookEntries();

      const again = await chooseAsGuest(first.id, `${SPECIALTY_CHOICE_COOKIE_NAME}=${first.id}`);
      expect(again.statusCode).toBe(200);
      expect(SpecialtyChoiceSchema.parse(again.json()).specialty).toEqual(first);

      const changed = await chooseAsGuest(second.id, cookieFrom(again));
      expect(changed.statusCode).toBe(200);
      expect(SpecialtyChoiceSchema.parse(changed.json()).specialty).toEqual(
        second,
      );
      expect(readSpecialtyChoiceCookie(cookieFrom(changed))).toBe(second.id);
    });

    it("EARS-6.4: «Другое» is remembered exactly like any other entry", async () => {
      const { other } = await bookEntries();
      const chosen = await chooseAsGuest(other.code);
      expect(chosen.statusCode).toBe(200);
      const body = SpecialtyChoiceSchema.parse(chosen.json());
      // LD-5: a real member, remembered by the same path — never a «no choice»
      // state and never a special case in the store.
      expect(body.specialty).toEqual(other);
      expect(body.specialty?.isOther).toBe(true);
      expect(body.storedIn).toBe("session");
    });

    it("EARS-6.5: a reference that names no member of the closed book is refused", async () => {
      const refused = await chooseAsGuest(randomUUID());
      expect(refused.statusCode).toBe(422);
      const problem = refused.json() as {
        errorCode: string;
        traceId: string;
        detail?: string;
      };
      expect(problem.errorCode).toBe("SPECIALTY_NOT_IN_BOOK");
      expect(problem.traceId).toBeTruthy();
      // Nothing was remembered — a refused choice writes no anonymous session.
      expect(refused.headers["set-cookie"]).toBeUndefined();
    });

    it("EARS-6.6: a doctor's choice is recorded on the profile as ONE primary link row", async () => {
      const doctor = await seedDoctor();
      const { first, second } = await bookEntries();

      const chosen = await choices.chooseAsDoctor(doctor.sub, first.code);
      expect(chosen.specialty).toEqual(first);
      expect(chosen.storedIn).toBe("profile");

      const afterFirst = await activeLinkRows(doctor.id);
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0]!.specialtyId).toBe(first.id);

      // Re-choosing the SAME entry touches nothing: no second row, no retired
      // row per click, and the answer is unchanged (017-design §7 idempotence).
      await choices.chooseAsDoctor(doctor.sub, first.id);
      expect(await activeLinkRows(doctor.id)).toHaveLength(1);

      // A DIFFERENT entry re-targets: still exactly one active primary — the
      // LD-1 cap is the partial unique index, not a service promise — and the
      // previous row survives as retired history rather than being overwritten.
      await choices.chooseAsDoctor(doctor.sub, second.id);
      const afterChange = await activeLinkRows(doctor.id);
      expect(afterChange).toHaveLength(1);
      expect(afterChange[0]!.specialtyId).toBe(second.id);

      const all = await db
        .select()
        .from(doctorSpecialties)
        .where(eq(doctorSpecialties.doctorId, doctor.id));
      const retired = all.filter((row) => row.status === "retired");
      expect(retired).toHaveLength(1);
      expect(retired[0]!.specialtyId).toBe(first.id);
      // The lifecycle CHECK the schema pins: retired ⇔ deleted_at set.
      expect(retired[0]!.deletedAt).not.toBeNull();
    });

    it("EARS-6.7: an anonymous choice is ADOPTED into a profile that holds none", async () => {
      const doctor = await seedDoctor();
      const { first } = await bookEntries();

      const resolved = await choices.resolveForDoctor(doctor.sub, first.id);
      expect(resolved.choice.specialty).toEqual(first);
      // It now lives on the PROFILE — the cross-device mechanism — and the
      // session value is consumed, so nothing is left to re-adopt later.
      expect(resolved.choice.storedIn).toBe("profile");
      expect(resolved.consumedSession).toBe(true);
      expect(await activeLinkRows(doctor.id)).toHaveLength(1);

      // Second navigation: nothing left in the session, profile answers.
      const again = await choices.resolveForDoctor(doctor.sub, null);
      expect(again.choice.specialty).toEqual(first);
      expect(again.consumedSession).toBe(false);
    });

    it("EARS-6.8: the PROFILE wins when it already holds one — the session value is discarded, never merged", async () => {
      const doctor = await seedDoctor();
      const { first, second } = await bookEntries();
      await choices.chooseAsDoctor(doctor.sub, first.id);

      const resolved = await choices.resolveForDoctor(doctor.sub, second.id);
      // No prompt, no merge, no queued conflict: the standing profile value is
      // the answer and the session one is dropped unread (LD-2).
      expect(resolved.choice.specialty).toEqual(first);
      expect(resolved.choice.storedIn).toBe("profile");
      expect(resolved.consumedSession).toBe(true);

      const rows = await activeLinkRows(doctor.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.specialtyId).toBe(first.id);
    });

    it("EARS-6.9: a session value the book no longer serves is forgotten, never adopted", async () => {
      const doctor = await seedDoctor();

      const resolved = await choices.resolveForDoctor(doctor.sub, randomUUID());
      expect(resolved.choice).toEqual({ specialty: null, storedIn: "none" });
      // Fail-closed: a non-member can be neither shown nor written to a profile.
      expect(await activeLinkRows(doctor.id)).toHaveLength(0);
    });
  },
);

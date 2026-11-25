import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  bootHarness,
  buildCourse,
  call,
  doctor,
  publish,
  type BuiltCourse,
  type Harness,
  type Problem,
} from "./harness.js";

// 023 EARS-6, EARS-7, EARS-26 (#4019) — the «скоро» school's interest record:
// an idempotent register and a withdraw per doctor and school that never touch
// the doctor's specialties, the read's «Вы в списке» flag, the staff count
// (never names) and the one school-opened notice per interested doctor on the
// school's first course publication, none on a replay or a later publication.

type Interest = {
  schoolId: string;
  state: "active" | "withdrawn";
  registeredAt: string;
  withdrawnAt: string | null;
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "023 learning — school interest and the school-opened notice (e2e)",
  () => {
    let h: Harness;
    /** A published school whose only course is still a draft («скоро»). */
    let first: BuiltCourse;
    let schoolSlug: string;

    const publishSchool = (schoolId: string) =>
      h.pool.query(
        "UPDATE learning_schools SET state = 'published' WHERE id = $1",
        [schoolId],
      );
    const interest = (method: "PUT" | "DELETE", schoolId: string, headers: Record<string, string>) =>
      call<Interest & Problem>(h, method, `/me/learning/schools/${schoolId}/interest`, headers);
    const read = (headers?: Record<string, string>) =>
      call<{ school: { status: string }; interested: boolean | null } & Problem>(
        h,
        "GET",
        `/learning/schools/${schoolSlug}`,
        headers,
      );
    const count = async (schoolId: string) => {
      const r = await admin<{ activeInterestCount: number } & Record<string, unknown>>(
        h,
        "GET",
        `/schools/${schoolId}`,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };
    const lettersFor = (slug: string) =>
      h.mailer.schoolOpenedNotices.filter((n) => n.schoolUrl.endsWith(`/schools/${slug}`));

    beforeAll(async () => {
      process.env.DOCTOR_PUBLIC_ORIGIN ??= "https://doctor.ds.test";
      h = await bootHarness();
      first = await buildCourse(h, {
        publish: false,
        school: { soonNote: "Первые курсы готовим вместе с экспертами" },
      });
      await publishSchool(first.schoolId);
      schoolSlug = `school-${first.f.suffix}`;
    });

    afterAll(async () => {
      await h?.close();
    });

    it("EARS-6: a published school without a published course reads soon with its note; a guest has no interest flag", async () => {
      const r = await read();
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.school).toMatchObject({ status: "soon" });
      expect(r.body.interested).toBeNull();
    });

    it("EARS-7: a guest is refused the interest write with 401 and nothing is stored", async () => {
      const r = await interest("PUT", first.schoolId, {});
      expect(r.status).toBe(401);
      const { rows } = await h.pool.query(
        "SELECT 1 FROM learning_school_interests WHERE school_id = $1",
        [first.schoolId],
      );
      expect(rows).toHaveLength(0);
    });

    it("EARS-7: a doctor's interest is stored once — a repeat answers the same interest — and the read shows it", async () => {
      const d = await doctor(h);
      expect((await read(d.headers)).body.interested).toBe(false);
      const one = await interest("PUT", first.schoolId, d.headers);
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body).toMatchObject({ schoolId: first.schoolId, state: "active", withdrawnAt: null });
      const again = await interest("PUT", first.schoolId, d.headers);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(one.body);
      const { rows } = await h.pool.query(
        "SELECT state FROM learning_school_interests WHERE person_id = $1 AND school_id = $2",
        [d.personId, first.schoolId],
      );
      expect(rows).toEqual([{ state: "active" }]);
      expect((await read(d.headers)).body.interested).toBe(true);
    });

    it("EARS-7: an interest never changes the doctor's specialties", async () => {
      const d = await doctor(h);
      const specialties = () =>
        h.pool
          .query(
            "SELECT specialty_id, role, status FROM doctor_specialties WHERE doctor_id = $1 ORDER BY id",
            [d.personId],
          )
          .then((r) => r.rows);
      const before = await specialties();
      expect((await interest("PUT", first.schoolId, d.headers)).status).toBe(200);
      expect((await interest("DELETE", first.schoolId, d.headers)).status).toBe(200);
      expect(await specialties()).toEqual(before);
    });

    it("EARS-7: a withdraw marks the interest withdrawn and the read shows the capture again; a second withdraw is 404", async () => {
      const d = await doctor(h);
      await interest("PUT", first.schoolId, d.headers);
      const out = await interest("DELETE", first.schoolId, d.headers);
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      expect(out.body.state).toBe("withdrawn");
      expect(out.body.withdrawnAt).not.toBeNull();
      expect((await read(d.headers)).body.interested).toBe(false);
      expect((await interest("DELETE", first.schoolId, d.headers)).status).toBe(404);
      // A register after a withdraw makes the same record active again.
      const back = await interest("PUT", first.schoolId, d.headers);
      expect(back.body).toMatchObject({ state: "active", withdrawnAt: null });
      expect((await interest("DELETE", first.schoolId, d.headers)).status).toBe(200);
    });

    it("EARS-7: an unknown, draft or malformed school is answered 404", async () => {
      const d = await doctor(h);
      expect((await interest("PUT", randomUUID(), d.headers)).status).toBe(404);
      expect((await interest("PUT", "not-a-uuid", d.headers)).status).toBe(404);
      const draft = await buildCourse(h, { publish: false });
      expect((await interest("PUT", draft.schoolId, d.headers)).status).toBe(404);
    });

    it("EARS-26: the staff school read carries the count of active interests and no doctor", async () => {
      const lone = await buildCourse(h, { publish: false });
      await publishSchool(lone.schoolId);
      const [a, b, c] = [await doctor(h), await doctor(h), await doctor(h)];
      for (const d of [a, b, c]) await interest("PUT", lone.schoolId, d.headers);
      await interest("DELETE", lone.schoolId, c.headers);
      const body = await count(lone.schoolId);
      expect(body.activeInterestCount).toBe(2);
      const text = JSON.stringify(body);
      for (const d of [a, b, c]) expect(text).not.toContain(d.personId);
      expect((await admin(h, "GET", `/schools/${randomUUID()}`)).status).toBe(404);
    });

    it("023 EARS-7: the school's first course publication sends one notice to each active interest; a later publication sends none", async () => {
      const school = await buildCourse(h, { publish: false });
      await publishSchool(school.schoolId);
      const slug = `school-${school.f.suffix}`;
      const [keen, left, late] = [await doctor(h), await doctor(h), await doctor(h)];
      await interest("PUT", school.schoolId, keen.headers);
      await interest("PUT", school.schoolId, left.headers);
      await interest("DELETE", school.schoolId, left.headers);

      await publish(h, school);
      // The letters leave the response path: wait for the dispatch to land.
      await expect.poll(() => lettersFor(slug).length).toBe(1);
      const letters = lettersFor(slug);
      const { rows: keenUser } = await h.pool.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1",
        [keen.personId],
      );
      expect(letters).toHaveLength(1);
      expect(letters[0]).toMatchObject({
        to: keenUser[0]!.email.toLowerCase(),
        courseTitle: expect.any(String),
        schoolUrl: new URL(`/schools/${slug}`, process.env.DOCTOR_PUBLIC_ORIGIN).toString(),
      });
      const { rows } = await h.pool.query<{ person_id: string; notified: boolean }>(
        "SELECT person_id, notified_at IS NOT NULL AS notified FROM learning_school_interests WHERE school_id = $1",
        [school.schoolId],
      );
      expect(rows.find((r) => r.person_id === keen.personId)?.notified).toBe(true);
      expect(rows.find((r) => r.person_id === left.personId)?.notified).toBe(false);

      // The open school takes no new interest (the capture is a «скоро»
      // state), and a later course publication in it sends nothing.
      const refused = await interest("PUT", school.schoolId, late.headers);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.errorCode).toBe("INVALID_TRANSITION");
      const second = await buildCourse(h, {
        into: { f: school.f, schoolId: school.schoolId },
        publish: false,
      });
      await publish(h, second);
      expect(lettersFor(slug)).toHaveLength(1);
    });

    it("023 EARS-7: a school that goes soon again and reopens never re-sends a doctor's notice", async () => {
      const school = await buildCourse(h, { publish: false });
      await publishSchool(school.schoolId);
      const slug = `school-${school.f.suffix}`;
      const d = await doctor(h);
      await interest("PUT", school.schoolId, d.headers);
      await publish(h, school);
      await expect.poll(() => lettersFor(slug).length).toBe(1);

      const course = await admin(h, "GET", `/courses/${school.courseId}`);
      const down = await admin(h, "POST", `/courses/${school.courseId}/unpublish`, {
        ifMatch: course.etag!,
      });
      expect(down.status, JSON.stringify(down.body)).toBe(200);
      const again = await admin(h, "GET", `/courses/${school.courseId}`);
      const up = await admin(h, "POST", `/courses/${school.courseId}/publish`, {
        ifMatch: again.etag!,
      });
      expect(up.status, JSON.stringify(up.body)).toBe(200);
      expect(lettersFor(slug)).toHaveLength(1);
    });

    it("023 EARS-7: the publish response never waits on the school-opened letters", async () => {
      const school = await buildCourse(h, { publish: false });
      await publishSchool(school.schoolId);
      const slug = `school-${school.f.suffix}`;
      const d = await doctor(h);
      await interest("PUT", school.schoolId, d.headers);
      const release = h.mailer.holdSchoolOpenedNotices();
      try {
        // The relay is held: a publish that awaited it would never answer.
        await publish(h, school);
        expect(lettersFor(slug)).toHaveLength(0);
      } finally {
        release();
      }
      await expect.poll(() => lettersFor(slug).length).toBe(1);
    });

    it("023 EARS-7: a rejected school-opened letter leaves the publish 200 and the claim set", async () => {
      const school = await buildCourse(h, { publish: false });
      await publishSchool(school.schoolId);
      const slug = `school-${school.f.suffix}`;
      const [a, b] = [await doctor(h), await doctor(h)];
      await interest("PUT", school.schoolId, a.headers);
      await interest("PUT", school.schoolId, b.headers);
      h.mailer.failNextSchoolOpenedNotice(new Error("relay down"));
      await publish(h, school);
      // One letter is rejected, the other is still sent; both claims stay.
      await expect.poll(() => lettersFor(slug).length).toBe(1);
      const { rows } = await h.pool.query<{ notified: boolean }>(
        "SELECT notified_at IS NOT NULL AS notified FROM learning_school_interests WHERE school_id = $1",
        [school.schoolId],
      );
      expect(rows.map((r) => r.notified)).toEqual([true, true]);
    });
  },
);

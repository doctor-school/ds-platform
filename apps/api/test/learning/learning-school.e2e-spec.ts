import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  answersFor,
  bootHarness,
  buildCourse,
  call,
  doctor,
  DEVICE,
  eventId,
  type BuiltCourse,
  type Harness,
  type Problem,
  VIDEO_SEC,
} from "./harness.js";

// 023 EARS-1, EARS-3, EARS-11, EARS-13, EARS-21, EARS-22 (#4017) — the school
// and course data over the 024 rows, the public school read with per-doctor
// course states, the course read's header data and the lesson read's course
// slug and first step.

type SchoolRead = {
  school: {
    slug: string;
    title: string;
    description: string;
    facts: { label: string; text: string }[];
    soonNote: string | null;
    communityUrl: string | null;
    mentoringOffer: string | null;
    internshipOffer: string | null;
    status: "open" | "soon";
    courseCount: number;
    lessonCount: number;
  };
  direction: { slug: string; title: string } | null;
  expert: { slug: string; name: string } | null;
  signedIn: boolean;
  courses: {
    id: string;
    slug: string;
    title: string;
    description: string;
    lessonCount: number;
    academicHours: number;
    document: { kind: string; prerequisites: string };
    partner: { name: string } | null;
    state: "not-started" | "started" | "done" | null;
  }[];
};

const FACTS = [
  { label: "Формат", text: "Видео и тесты" },
  { label: "Эксперт", text: "Ведущий кардиолог" },
  { label: "Длительность", text: "Шесть недель" },
  { label: "Документ", text: "Сертификат" },
];

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "023 learning — the school read and the course header data (e2e)",
  () => {
    let h: Harness;
    let first: BuiltCourse;
    let second: BuiltCourse;
    let schoolSlug: string;
    let partnerName: string;

    const organisation = async (publicName: boolean) => {
      const slug = `learn-org-${randomUUID().slice(0, 8)}`;
      const { rows } = await h.pool.query<{ id: string }>(
        "INSERT INTO organisations (slug, title, status, first_published_at, public_name_visible) VALUES ($1, $2, 'published', now(), $3) RETURNING id",
        [slug, `Партнёр ${slug}`, publicName],
      );
      return { id: rows[0]!.id, name: `Партнёр ${slug}` };
    };

    const publishSchool = (schoolId: string) =>
      h.pool.query("UPDATE learning_schools SET state = 'published' WHERE id = $1", [
        schoolId,
      ]);

    const read = (slug: string, headers: Record<string, string> = DEVICE) =>
      call<SchoolRead & Problem>(h, "GET", `/learning/schools/${slug}`, headers);

    beforeAll(async () => {
      h = await bootHarness();
      const partner = await organisation(true);
      const hidden = await organisation(false);
      partnerName = partner.name;
      first = await buildCourse(h, {
        school: {
          description: "Школа о гипертензии",
          facts: FACTS,
          soonNote: "Готовим первый курс",
          communityUrl: "https://t.me/example_school",
          mentoringOffer: "Наставник разбирает случаи",
          internshipOffer: "Стажировка в клинике",
        },
        course: {
          description: "От измерения к терапии",
          academicHours: 18,
          documentKind: "certificate-nmo",
          documentPrerequisites: "Подтверждённые документы",
          partnerOrganisationId: partner.id,
        },
      });
      const into = { f: first.f, schoolId: first.schoolId };
      second = await buildCourse(h, {
        into,
        course: { academicHours: 6, partnerOrganisationId: hidden.id },
      });
      // A draft course of the school never reaches a doctor read.
      await buildCourse(h, { into, publish: false });
      schoolSlug = `school-${first.f.suffix}`;
    });

    afterAll(async () => {
      await h?.close();
    });

    it("023 EARS-1: the admin school create keeps the school's data and answers it", async () => {
      const list = await admin<{ data: { id: string }[] }>(h, "GET", "/schools");
      expect(list.status).toBe(200);
      const school = list.body.data.find((s) => s.id === first.schoolId);
      expect(school).toMatchObject({
        description: "Школа о гипертензии",
        facts: FACTS,
        soonNote: "Готовим первый курс",
        communityUrl: "https://t.me/example_school",
        mentoringOffer: "Наставник разбирает случаи",
        internshipOffer: "Стажировка в клинике",
      });
    });

    it("023 EARS-1: more than four facts or a non-https community link are refused", async () => {
      const base = {
        directionId: first.f.directionId,
        leadExpertId: first.f.expertId,
        projectId: first.f.projectId,
        slug: `school-x-${randomUUID().slice(0, 8)}`,
        title: "Школа",
      };
      const five = await admin<Problem>(h, "POST", "/schools", {
        payload: { ...base, facts: [...FACTS, FACTS[0]] },
      });
      expect(five.status).toBe(400);
      const link = await admin<Problem>(h, "POST", "/schools", {
        payload: { ...base, communityUrl: "http://example.test" },
      });
      expect(link.status).toBe(400);
    });

    it("023 EARS-1: the admin course create keeps the course's data and places it last in its school", async () => {
      const course = await admin(h, "GET", `/courses/${first.courseId}`);
      expect(course.body).toMatchObject({
        description: "От измерения к терапии",
        academicHours: 18,
        documentKind: "certificate-nmo",
        documentPrerequisites: "Подтверждённые документы",
        position: 1,
      });
      const next = await admin(h, "GET", `/courses/${second.courseId}`);
      expect(next.body).toMatchObject({
        description: "",
        academicHours: 6,
        documentKind: "certificate",
        position: 2,
      });
    });

    it("023 EARS-1: an unknown partner organisation is a field error", async () => {
      const bad = await admin<Problem>(h, "POST", "/courses", {
        payload: {
          schoolId: first.schoolId,
          projectId: first.f.projectId,
          slug: `course-x-${randomUUID().slice(0, 8)}`,
          title: "Курс",
          partnerOrganisationId: randomUUID(),
        },
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errors?.map((e) => e.path)).toContain("partnerOrganisationId");
    });

    it("023 EARS-3: a draft or unknown school is answered 404", async () => {
      expect((await read(schoolSlug)).status).toBe(404);
      expect((await read(`no-such-school-${first.f.suffix}`)).status).toBe(404);
    });

    it("023 EARS-3: a guest reads the published school with its data, courses in school order and no states", async () => {
      await publishSchool(first.schoolId);
      const r = await read(schoolSlug);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.school).toMatchObject({
        slug: schoolSlug,
        description: "Школа о гипертензии",
        facts: FACTS,
        status: "open",
        courseCount: 2,
        lessonCount: 2,
      });
      expect(r.body.direction?.slug).toBe(`learn-dir-${first.f.suffix}`);
      expect(r.body.expert?.slug).toBe(`learn-exp-${first.f.suffix}`);
      expect(r.body.signedIn).toBe(false);
      expect(r.body.courses.map((c) => c.id)).toEqual([first.courseId, second.courseId]);
      expect(r.body.courses[0]).toMatchObject({
        slug: first.courseSlug,
        description: "От измерения к терапии",
        lessonCount: 1,
        academicHours: 18,
        document: { kind: "certificate-nmo", prerequisites: "Подтверждённые документы" },
        state: null,
      });
      // EARS-22 — the 032 name, only WHILE the organisation shows it publicly.
      expect(r.body.courses[0]!.partner).toEqual({ name: partnerName });
      expect(r.body.courses[1]!.partner).toBeNull();
    });

    it("023 EARS-3: a school with no published course is soon", async () => {
      const lone = await buildCourse(h, { publish: false });
      await publishSchool(lone.schoolId);
      const r = await read(`school-${lone.f.suffix}`);
      expect(r.status).toBe(200);
      expect(r.body.school).toMatchObject({ status: "soon", courseCount: 0, lessonCount: 0 });
      expect(r.body.courses).toEqual([]);
    });

    it("023 EARS-3: a signed-in doctor reads each course's state from the 024 evaluator", async () => {
      await publishSchool(first.schoolId);
      const d = await doctor(h);
      const states = async () =>
        (await read(schoolSlug, d.headers)).body.courses.map((c) => c.state);
      const fresh = await read(schoolSlug, d.headers);
      expect(fresh.body.signedIn).toBe(true);
      expect(await states()).toEqual(["not-started", "not-started"]);

      const fact = (body: Record<string, unknown>) =>
        call(h, "POST", "/me/learning/facts", d.headers, {
          eventId: eventId(),
          source: "web",
          ...body,
        });
      const position = (positionSec: number) =>
        fact({ stepId: first.videoId, kind: "position", data: { positionSec } });
      expect((await position(VIDEO_SEC / 2)).status).toBe(200);
      h.advanceClock(VIDEO_SEC / 2);
      expect((await position(VIDEO_SEC)).status).toBe(200);
      expect(await states()).toEqual(["started", "not-started"]);

      expect(
        (await fact({ stepId: first.downloadId, kind: "opened", data: {} })).status,
      ).toBe(200);
      const attempt = await call<{ attemptId: string; questions: { id: string }[] }>(
        h,
        "POST",
        `/me/learning/tests/${first.testId}/attempts`,
        d.headers,
      );
      expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);
      const submitted = await call(
        h,
        "POST",
        `/me/learning/attempts/${attempt.body.attemptId}/submit`,
        d.headers,
        { answers: answersFor(first, attempt.body) },
      );
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      expect(await states()).toEqual(["done", "not-started"]);
    });

    it("023 EARS-11: the course read carries the course data, the school breadcrumb and the expert", async () => {
      const r = await call<{
        course: Record<string, unknown>;
        school: { slug: string; title: string };
        author: { slug: string } | null;
      }>(h, "GET", `/learning/courses/${first.courseSlug}/path`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.course).toMatchObject({
        description: "От измерения к терапии",
        academicHours: 18,
        lessonCount: 1,
        document: { kind: "certificate-nmo", prerequisites: "Подтверждённые документы" },
        partner: { name: partnerName },
      });
      expect(r.body.school.slug).toBe(schoolSlug);
      expect(r.body.author?.slug).toBe(`learn-exp-${first.f.suffix}`);
    });

    it("023 EARS-13: the course read carries the rules summary built from the resolved completion rule, never a preset name", async () => {
      const r = await call<{ course: { rulesSummary: string } }>(
        h,
        "GET",
        `/learning/courses/${first.courseSlug}/path`,
      );
      const course = await admin<{ values: unknown; appliedPreset: string | null }>(
        h,
        "GET",
        `/rules/course/${first.courseId}`,
      );
      expect(typeof r.body.course.rulesSummary).toBe("string");
      expect(r.body.course.rulesSummary.length).toBeGreaterThan(0);
      if (course.body.appliedPreset)
        expect(r.body.course.rulesSummary).not.toContain(course.body.appliedPreset);
    });

    it("023 EARS-21: the lesson read carries the course slug and the lesson's first step", async () => {
      const r = await call<{
        course: { slug: string };
        lesson: { firstStepId: string | null };
      }>(h, "GET", `/learning/lessons/${first.lessonId}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.course.slug).toBe(first.courseSlug);
      expect(r.body.lesson.firstStepId).toBe(first.videoId);
    });
  },
);

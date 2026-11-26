import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  bootHarness,
  buildCourse,
  call,
  doctor,
  DEVICE,
  type BuiltCourse,
  type Harness,
  type Problem,
} from "./harness.js";
import { seedTaxonomy } from "./fixtures.js";

// 023 EARS-26, EARS-27 (without the module club and reward), EARS-28 (#4018) —
// the structure editor's admin endpoints: a school's EARS-1 data, its publish
// and unpublish (a draft school is 404 to doctors, a published one is read),
// a course's EARS-1 data, the course order in a school, a module's rename and
// the module order in a course, an empty course's publish refusal — every one
// under the 024 EARS-30 envelope (admin session + CSRF, Idempotency-Key,
// `If-Match` → 412 on a stale version) with one 010 audit row per change.

type School = {
  id: string;
  slug: string;
  state: "draft" | "published";
  title: string;
  description: string;
  facts: { label: string; text: string }[];
  soonNote: string | null;
  communityUrl: string | null;
  mentoringOffer: string | null;
  internshipOffer: string | null;
  version: number;
};
type Course = {
  id: string;
  title: string;
  description: string;
  academicHours: number;
  documentKind: string;
  documentPrerequisites: string;
  position: number;
  state: string;
  modules?: { id: string; title: string; position: number; version: number }[];
};
type SchoolRead = {
  school: { status: "open" | "soon"; title: string; description: string };
  courses: { id: string }[];
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "023 learning — the school, course and module editor endpoints (e2e)",
  () => {
    let h: Harness;

    beforeAll(async () => {
      h = await bootHarness();
    });

    afterAll(async () => {
      await h?.close();
    });

    /** A fresh draft school (its own taxonomy, so one expert per direction holds). */
    const draftSchool = async (): Promise<School> => {
      const f = await seedTaxonomy(h.pool);
      const r = await admin<School>(h, "POST", "/schools", {
        payload: {
          directionId: f.directionId,
          leadExpertId: f.expertId,
          projectId: f.projectId,
          slug: `editor-school-${f.suffix}`,
          title: `Школа ${f.suffix}`,
        },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body;
    };

    const etagOf = async (path: string): Promise<string> => {
      const r = await admin(h, "GET", path);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.etag).toBeTruthy();
      return r.etag!;
    };

    const read = (slug: string) =>
      call<SchoolRead & Problem>(h, "GET", `/learning/schools/${slug}`, DEVICE);

    const auditRows = async (event: string, id: string) =>
      (
        await h.pool.query<{ subject_id: string | null }>(
          `SELECT subject_id FROM audit_ledger
            WHERE event_type = $1 AND metadata -> 'pk' ->> 'id' = $2`,
          [event, id],
        )
      ).rows;

    // ── School (EARS-26) ──────────────────────────────────────────────────

    it("EARS-26: GET /schools/{id} carries the school's version as its ETag", async () => {
      const s = await draftSchool();
      const r = await admin<School>(h, "GET", `/schools/${s.id}`);
      expect(r.status).toBe(200);
      expect(r.etag).toBe(`W/"${s.version}"`);
    });

    it("EARS-26: PATCH /schools/{id} edits the EARS-1 data under If-Match and leaves one audit row", async () => {
      const s = await draftSchool();
      const facts = [
        { label: "Формат", text: "Видео и тесты" },
        { label: "Документ", text: "Сертификат" },
      ];
      const r = await admin<School>(h, "PATCH", `/schools/${s.id}`, {
        payload: {
          title: "Школа гипертензии",
          description: "Всё о давлении",
          facts,
          soonNote: "Первый курс готовится",
          communityUrl: "https://t.me/editor_school",
          mentoringOffer: "Разбор случаев",
          internshipOffer: "Стажировка",
        },
        ifMatch: await etagOf(`/schools/${s.id}`),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({
        title: "Школа гипертензии",
        description: "Всё о давлении",
        facts,
        soonNote: "Первый курс готовится",
        communityUrl: "https://t.me/editor_school",
        mentoringOffer: "Разбор случаев",
        internshipOffer: "Стажировка",
        version: s.version + 1,
      });
      expect(r.etag).toBe(`W/"${s.version + 1}"`);
      // The optional texts clear back to «none».
      const cleared = await admin<School>(h, "PATCH", `/schools/${s.id}`, {
        payload: { soonNote: null, communityUrl: null },
        ifMatch: r.etag!,
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(cleared.body).toMatchObject({ soonNote: null, communityUrl: null });
      const audit = await auditRows("data.learning_schools.update", s.id);
      expect(audit).toHaveLength(2);
      expect(audit.every((a) => a.subject_id !== null)).toBe(true);
    });

    it("EARS-28: a school edit without If-Match is 428, a stale one 412, without a key 428, bad data 400", async () => {
      const s = await draftSchool();
      const missing = await admin<Problem>(h, "PATCH", `/schools/${s.id}`, {
        payload: { title: "Новое" },
      });
      expect(missing.status).toBe(428);
      expect(missing.body.errorCode).toBe("PRECONDITION_REQUIRED");
      const etag = await etagOf(`/schools/${s.id}`);
      const ok = await admin(h, "PATCH", `/schools/${s.id}`, {
        payload: { title: "Новое" },
        ifMatch: etag,
      });
      expect(ok.status).toBe(200);
      const stale = await admin<Problem>(h, "PATCH", `/schools/${s.id}`, {
        payload: { title: "Ещё новее" },
        ifMatch: etag,
      });
      expect(stale.status).toBe(412);
      expect(stale.body.errorCode).toBe("PRECONDITION_FAILED");
      const noKey = await admin<Problem>(h, "PATCH", `/schools/${s.id}`, {
        payload: { title: "Без ключа" },
        ifMatch: ok.etag!,
        key: null,
      });
      expect(noKey.status).toBe(428);
      expect(noKey.body.errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
      const bad = await admin<Problem>(h, "PATCH", `/schools/${s.id}`, {
        payload: { communityUrl: "http://example.test" },
        ifMatch: ok.etag!,
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errors?.map((e) => e.path)).toContain("communityUrl");
      const empty = await admin<Problem>(h, "PATCH", `/schools/${s.id}`, {
        payload: {},
        ifMatch: ok.etag!,
      });
      expect(empty.status).toBe(400);
    });

    it("EARS-26: a published school is read by doctors (`soon` without a published course, `open` with one); unpublished it is 404 again", async () => {
      const s = await draftSchool();
      expect((await read(s.slug)).status).toBe(404);
      const published = await admin<School>(h, "POST", `/schools/${s.id}/publish`, {
        ifMatch: await etagOf(`/schools/${s.id}`),
      });
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(published.body.state).toBe("published");
      const soon = await read(s.slug);
      expect(soon.status, JSON.stringify(soon.body)).toBe(200);
      expect(soon.body.school.status).toBe("soon");
      expect(
        await auditRows("data.learning_schools.update", s.id),
      ).toHaveLength(1);
      // A second publish is not a transition.
      const again = await admin<Problem>(h, "POST", `/schools/${s.id}/publish`, {
        ifMatch: published.etag!,
      });
      expect(again.status).toBe(409);
      const unpublished = await admin<School>(
        h,
        "POST",
        `/schools/${s.id}/unpublish`,
        { ifMatch: published.etag! },
      );
      expect(unpublished.status, JSON.stringify(unpublished.body)).toBe(200);
      expect(unpublished.body.state).toBe("draft");
      expect((await read(s.slug)).status).toBe(404);
    });

    it("EARS-26: a published school with a published course reads `open`", async () => {
      const c = await buildCourse(h);
      const p = await admin(h, "POST", `/schools/${c.schoolId}/publish`, {
        ifMatch: await etagOf(`/schools/${c.schoolId}`),
      });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      const r = await read(`school-${c.f.suffix}`);
      expect(r.status).toBe(200);
      expect(r.body.school.status).toBe("open");
      expect(r.body.courses.map((x) => x.id)).toEqual([c.courseId]);
    });

    it("EARS-28: a doctor session is refused on the editor routes", async () => {
      const s = await draftSchool();
      const d = await doctor(h);
      for (const [method, url] of [
        ["PATCH", `/v1/admin/learning/schools/${s.id}`],
        ["POST", `/v1/admin/learning/schools/${s.id}/publish`],
        ["PUT", `/v1/admin/learning/schools/${s.id}/course-order`],
        ["PATCH", `/v1/admin/learning/courses/${randomUUID()}`],
        ["PUT", `/v1/admin/learning/courses/${randomUUID()}/module-order`],
        ["PATCH", `/v1/admin/learning/modules/${randomUUID()}`],
      ] as const) {
        const res = await h.app.inject({
          method,
          url,
          headers: {
            ...d.headers,
            "idempotency-key": randomUUID(),
            "if-match": 'W/"1"',
            "content-type": "application/json",
          },
          payload: {},
        });
        expect([401, 403], `${method} ${url}`).toContain(res.statusCode);
      }
    });

    // ── Courses and modules (EARS-27) ─────────────────────────────────────

    let tree: BuiltCourse;
    let extra: Course;

    it("EARS-27: PATCH /courses/{id} edits the course's EARS-1 data under If-Match", async () => {
      tree = await buildCourse(h, { publish: false });
      const r = await admin<Course>(h, "PATCH", `/courses/${tree.courseId}`, {
        payload: {
          title: "Гипертензия: от измерения к терапии",
          description: "Курс о давлении",
          academicHours: 36,
          documentKind: "certificate-nmo",
          documentPrerequisites: "Подтверждённые документы",
        },
        ifMatch: await etagOf(`/courses/${tree.courseId}`),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({
        title: "Гипертензия: от измерения к терапии",
        description: "Курс о давлении",
        academicHours: 36,
        documentKind: "certificate-nmo",
        documentPrerequisites: "Подтверждённые документы",
      });
      const stale = await admin<Problem>(h, "PATCH", `/courses/${tree.courseId}`, {
        payload: { title: "Устарело" },
        ifMatch: `W/"1"`,
      });
      expect(stale.status).toBe(412);
      const partner = await admin<Problem>(h, "PATCH", `/courses/${tree.courseId}`, {
        payload: { partnerOrganisationId: randomUUID() },
        ifMatch: r.etag!,
      });
      expect(partner.status).toBe(400);
      expect(partner.body.errors?.map((e) => e.path)).toContain(
        "partnerOrganisationId",
      );
      expect(
        await auditRows("data.learning_courses.update", tree.courseId),
      ).toHaveLength(1);
    });

    it("EARS-27: publishing a course without a published lesson is refused 409 PUBLISH_REQUIREMENTS_NOT_MET", async () => {
      const r = await admin<Course>(h, "POST", "/courses", {
        payload: {
          schoolId: tree.schoolId,
          projectId: tree.f.projectId,
          slug: `editor-empty-${randomUUID().slice(0, 8)}`,
          title: "Пустой курс",
        },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      extra = r.body;
      expect(extra.position).toBe(2);
      const refused = await admin<Problem>(h, "POST", `/courses/${extra.id}/publish`, {
        ifMatch: r.etag!,
      });
      expect(refused.status).toBe(409);
      expect(refused.body.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
    });

    it("EARS-27: PUT /schools/{id}/course-order orders the school's courses under the school's If-Match", async () => {
      const etag = await etagOf(`/schools/${tree.schoolId}`);
      const r = await admin<School>(h, "PUT", `/schools/${tree.schoolId}/course-order`, {
        payload: { courseIds: [extra.id, tree.courseId] },
        ifMatch: etag,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const listed = await admin<{ data: Course[] }>(
        h,
        "GET",
        `/courses?schoolId=${tree.schoolId}`,
      );
      expect(listed.body.data.map((c) => c.id)).toEqual([extra.id, tree.courseId]);
      expect(listed.body.data.map((c) => c.position)).toEqual([1, 2]);
      const stale = await admin<Problem>(
        h,
        "PUT",
        `/schools/${tree.schoolId}/course-order`,
        { payload: { courseIds: [tree.courseId, extra.id] }, ifMatch: etag },
      );
      expect(stale.status).toBe(412);
      const partial = await admin<Problem>(
        h,
        "PUT",
        `/schools/${tree.schoolId}/course-order`,
        { payload: { courseIds: [tree.courseId] }, ifMatch: r.etag! },
      );
      expect(partial.status).toBe(400);
      expect(partial.body.errors?.map((e) => e.path)).toContain("courseIds");
    });

    it("EARS-27: PATCH /modules/{id} renames a module and PUT /courses/{id}/module-order orders the modules", async () => {
      const second = await admin<{ id: string }>(h, "POST", "/modules", {
        payload: { courseId: tree.courseId, title: "Модуль 2" },
      });
      expect(second.status).toBe(201);
      const composition = await admin<Course>(h, "GET", `/courses/${tree.courseId}`);
      const first = composition.body.modules!.find((m) => m.id === tree.moduleId)!;
      const renamed = await admin<{ title: string; version: number }>(
        h,
        "PATCH",
        `/modules/${tree.moduleId}`,
        { payload: { title: "Диагностика" }, ifMatch: `W/"${first.version}"` },
      );
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(renamed.body.title).toBe("Диагностика");
      const staleRename = await admin<Problem>(h, "PATCH", `/modules/${tree.moduleId}`, {
        payload: { title: "Устарело" },
        ifMatch: `W/"${first.version}"`,
      });
      expect(staleRename.status).toBe(412);
      const ordered = await admin<Course>(
        h,
        "PUT",
        `/courses/${tree.courseId}/module-order`,
        {
          payload: { moduleIds: [second.body.id, tree.moduleId] },
          ifMatch: composition.etag!,
        },
      );
      expect(ordered.status, JSON.stringify(ordered.body)).toBe(200);
      const after = await admin<Course>(h, "GET", `/courses/${tree.courseId}`);
      expect(after.body.modules!.map((m) => [m.id, m.title])).toEqual([
        [second.body.id, "Модуль 2"],
        [tree.moduleId, "Диагностика"],
      ]);
      const duplicate = await admin<Problem>(
        h,
        "PUT",
        `/courses/${tree.courseId}/module-order`,
        {
          payload: { moduleIds: [tree.moduleId, tree.moduleId] },
          ifMatch: after.etag!,
        },
      );
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.errors?.map((e) => e.path)).toContain("moduleIds");
      expect(
        await auditRows("data.learning_modules.update", tree.moduleId),
      ).not.toHaveLength(0);
    });
  },
);

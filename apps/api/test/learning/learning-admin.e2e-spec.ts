import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LEARNING_PLATFORM_SEED,
  LEARNING_PRESET_SEEDS,
} from "@ds/learning";
import { MediaSlotRegistry } from "../../src/taxonomy/media/media-slot.registry.js";
import {
  admin,
  bootHarness,
  buildCourse,
  doctor,
  multipartFile,
  PDF,
  type BuiltCourse,
  type Harness,
  type Problem,
} from "./harness.js";
import { seedStructure, seedTaxonomy } from "./fixtures.js";

// 024 EARS-1, EARS-4, EARS-5, EARS-9, EARS-10, EARS-26, EARS-28, EARS-29
// (#4011) — the admin side over HTTP: the 012 command envelope (authority,
// validation, Idempotency-Key, If-Match), the publish gate, the step source
// and media slot, rules and presets; plus the seeded data and the facts
// table's append-only trigger.

type Preset = { id: string; name: string; values: Record<string, unknown> };
type Rules = {
  values: Record<string, unknown>;
  appliedPreset: string | null;
  effective: { key: string; value: unknown; level: string }[];
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "024 learning — admin API, seed and facts ledger (e2e)",
  () => {
    let h: Harness;
    let c: BuiltCourse;

    beforeAll(async () => {
      h = await bootHarness();
      c = await buildCourse(h);
    });

    afterAll(async () => {
      await h?.close();
    });

    const draftLesson = async (): Promise<{ lessonId: string }> => {
      const r = await admin<{ id: string }>(h, "POST", "/lessons", {
        payload: { moduleId: c.moduleId, projectId: c.f.projectId, title: "Черновик" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return { lessonId: r.body.id };
    };

    const step = (lessonId: string, type: string, payload: unknown) =>
      admin<{ id: string } & Problem>(h, "POST", "/steps", {
        payload: { lessonId, type, title: type, durationMin: 1, payload },
      });

    const publishLesson = async (lessonId: string) => {
      const l = await admin(h, "GET", `/lessons/${lessonId}`);
      return admin<Problem>(h, "POST", `/lessons/${lessonId}/publish`, {
        ifMatch: l.etag!,
      });
    };

    // ── Seed as data (EARS-26, EARS-9) ────────────────────────────────────

    it("EARS-26: the platform rule layer row equals LEARNING_PLATFORM_SEED", async () => {
      const { rows } = await h.pool.query<{ values: Record<string, unknown> }>(
        "SELECT values FROM learning_rule_layers WHERE scope_kind = 'platform' AND scope_id = 'platform'",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.values).toEqual(LEARNING_PLATFORM_SEED);
      expect(rows[0]!.values["test.exitRequired"]).toBe(true);
    });

    it("EARS-9: the preset rows equal LEARNING_PRESET_SEEDS and GET /presets serves them", async () => {
      const r = await admin<{ data: Preset[] }>(h, "GET", "/presets");
      expect(r.status).toBe(200);
      const served = Object.fromEntries(r.body.data.map((p) => [p.name, p.values]));
      for (const seed of LEARNING_PRESET_SEEDS) {
        expect(served[seed.name], seed.name).toEqual(seed.values);
      }
      expect(r.body.data).toHaveLength(LEARNING_PRESET_SEEDS.length);
    });

    // ── Facts ledger (EARS-10) ────────────────────────────────────────────

    it("EARS-10: learning_facts is append-only — UPDATE and DELETE are refused by the trigger", async () => {
      const f = await seedTaxonomy(h.pool);
      const s = await seedStructure(h.pool, f);
      const { rows } = await h.pool.query<{ id: string }>(
        "INSERT INTO learning_facts (event_id, person_id, kind, step_id, source, occurred_at) VALUES ($1, $2, 'opened', $3, 'system', now()) RETURNING id",
        [`e2e-${randomUUID()}`, f.userId, s.stepId],
      );
      const id = rows[0]!.id;
      await expect(
        h.pool.query("UPDATE learning_facts SET kind = 'done' WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/);
      await expect(
        h.pool.query("DELETE FROM learning_facts WHERE id = $1", [id]),
      ).rejects.toThrow(/append-only/);
      const still = await h.pool.query("SELECT 1 FROM learning_facts WHERE id = $1", [id]);
      expect(still.rowCount).toBe(1);
    });

    it("EARS-28: the booted app registers learning_steps.media_ref as a media slot", () => {
      expect(h.app.get(MediaSlotRegistry).names()).toContain("learning_steps.media_ref");
    });

    // ── Authority and the 012 envelope (EARS-28) ──────────────────────────

    it("EARS-28: a doctor session is refused on admin routes", async () => {
      const d = await doctor(h);
      for (const [method, url] of [
        ["GET", "/v1/admin/learning/schools"],
        ["POST", "/v1/admin/learning/schools"],
      ] as const) {
        const res = await h.app.inject({
          method,
          url,
          headers: { ...d.headers, "idempotency-key": randomUUID() },
          ...(method === "POST" ? { payload: {} } : {}),
        });
        expect([401, 403], `${method} ${url}`).toContain(res.statusCode);
      }
    });

    it("EARS-1: a school with a bad slug is refused 400 naming the field", async () => {
      const r = await admin<Problem>(h, "POST", "/schools", {
        payload: {
          directionId: c.f.directionId,
          leadExpertId: c.f.expertId,
          projectId: c.f.projectId,
          slug: "Bad Slug!",
          title: "Школа",
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.errorCode).toBe("VALIDATION_FAILED");
      expect(r.body.errors?.map((e) => e.path)).toContain("slug");
    });

    it("EARS-1: GET /schools and GET /courses?schoolId= list the built rows", async () => {
      const schools = await admin<{ data: { id: string }[] }>(h, "GET", "/schools");
      expect(schools.status).toBe(200);
      expect(schools.body.data.map((s) => s.id)).toContain(c.schoolId);
      const courses = await admin<{ data: { id: string }[] }>(
        h,
        "GET",
        `/courses?schoolId=${c.schoolId}`,
      );
      expect(courses.status).toBe(200);
      expect(courses.body.data.map((x) => x.id)).toEqual([c.courseId]);
    });

    it("EARS-28: an unknown step type is refused 400 naming `type`", async () => {
      const r = await step(c.lessonId, "hologram", {});
      expect(r.status).toBe(400);
      expect(r.body.errors?.map((e) => e.path)).toContain("type");
    });

    it("EARS-28: a write without an Idempotency-Key is refused 428", async () => {
      const r = await admin<Problem>(h, "POST", "/modules", {
        payload: { courseId: c.courseId, title: "Без ключа" },
        key: null,
      });
      expect(r.status).toBe(428);
      expect(r.body.errorCode).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("EARS-28: a replay with the same key returns the same body without a second row", async () => {
      const key = randomUUID();
      const payload = { courseId: c.courseId, title: `Повтор ${key.slice(0, 6)}` };
      const a = await admin<{ id: string }>(h, "POST", "/modules", { payload, key });
      const b = await admin<{ id: string }>(h, "POST", "/modules", { payload, key });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body).toEqual(a.body);
      const { rowCount } = await h.pool.query(
        "SELECT 1 FROM learning_modules WHERE course_id = $1 AND title = $2",
        [c.courseId, payload.title],
      );
      expect(rowCount).toBe(1);
    });

    it("EARS-28: a versioned write without If-Match is 428, with a stale one 412", async () => {
      const lesson = await admin(h, "GET", `/lessons/${c.lessonId}`);
      const missing = await admin<Problem>(h, "PATCH", `/lessons/${c.lessonId}`, {
        payload: { title: "Новое имя" },
      });
      expect(missing.status).toBe(428);
      expect(missing.body.errorCode).toBe("PRECONDITION_REQUIRED");
      const ok = await admin(h, "PATCH", `/lessons/${c.lessonId}`, {
        payload: { title: "Урок 1" },
        ifMatch: lesson.etag!,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const stale = await admin<Problem>(h, "PATCH", `/lessons/${c.lessonId}`, {
        payload: { title: "Устаревшее" },
        ifMatch: lesson.etag!,
      });
      expect(stale.status).toBe(412);
      expect(stale.body.errorCode).toBe("PRECONDITION_FAILED");
    });

    // ── Publish gate (EARS-4) ─────────────────────────────────────────────

    it("EARS-4: an empty lesson is refused 409 PUBLISH_REQUIREMENTS_NOT_MET naming `steps` and `exitTest`", async () => {
      const { lessonId } = await draftLesson();
      const r = await publishLesson(lessonId);
      expect(r.status).toBe(409);
      expect(r.body.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      const paths = r.body.errors?.map((e) => e.path);
      expect(paths).toContain("steps");
      expect(paths).toContain("exitTest");
    });

    it("EARS-4: a video without a source and a download without a file are named `steps.N.source` / `steps.N.media`", async () => {
      const { lessonId } = await draftLesson();
      expect((await step(lessonId, "video", { durationSec: 30 })).status).toBe(201);
      expect((await step(lessonId, "download", { fileName: "a.pdf" })).status).toBe(201);
      const r = await publishLesson(lessonId);
      expect(r.status).toBe(409);
      const paths = r.body.errors?.map((e) => e.path) ?? [];
      expect(paths).toContain("steps.0.source");
      expect(paths).toContain("steps.1.media");
      expect(paths).toContain("exitTest");
    });

    it("EARS-4: a course with no published lesson is refused 409", async () => {
      const course = await admin<{ id: string }>(h, "POST", "/courses", {
        payload: {
          schoolId: c.schoolId,
          projectId: c.f.projectId,
          slug: `course-empty-${randomUUID().slice(0, 8)}`,
          title: "Пустой курс",
        },
      });
      expect(course.status).toBe(201);
      const read = await admin(h, "GET", `/courses/${course.body.id}`);
      const r = await admin<Problem>(h, "POST", `/courses/${course.body.id}/publish`, {
        ifMatch: read.etag!,
      });
      expect(r.status).toBe(409);
      expect(r.body.errorCode).toBe("PUBLISH_REQUIREMENTS_NOT_MET");
      expect(r.body.errors?.map((e) => e.path)).toContain("lessons");
    });

    // ── Step source and media (EARS-28) ───────────────────────────────────

    it("EARS-28: a source whose embedRef does not fit the provider is refused 400", async () => {
      const { lessonId } = await draftLesson();
      const video = await step(lessonId, "video", { durationSec: 30 });
      const r = await admin<Problem>(h, "PUT", `/steps/${video.body.id}/source`, {
        payload: { provider: "youtube", embedRef: "not a youtube id!" },
        ifMatch: video.etag!,
      });
      expect(r.status).toBe(400);
      expect(r.body.errorCode).toBe("VALIDATION_FAILED");
    });

    it("EARS-28: a source on a download step is refused 400", async () => {
      const { lessonId } = await draftLesson();
      const d =await step(lessonId, "download", { fileName: "a.pdf" });
      const r = await admin<Problem>(h, "PUT", `/steps/${d.body.id}/source`, {
        payload: { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
        ifMatch: d.etag!,
      });
      expect(r.status).toBe(400);
    });

    it("EARS-28: a download file of a refused content type is MEDIA_INVALID; a file on a video step is 400", async () => {
      const { lessonId } = await draftLesson();
      const d = await step(lessonId, "download", { fileName: "a.exe" });
      const bad = await admin<Problem>(h, "PUT", `/steps/${d.body.id}/media`, {
        raw: multipartFile({
          field: "file",
          filename: "a.exe",
          contentType: "application/x-msdownload",
          body: Buffer.from("MZ"),
        }),
        ifMatch: d.etag!,
      });
      expect(bad.status).toBe(400);
      expect(bad.body.errorCode).toBe("MEDIA_INVALID");
      const v = await step(lessonId, "video", { durationSec: 30 });
      const onVideo = await admin<Problem>(h, "PUT", `/steps/${v.body.id}/media`, {
        raw: multipartFile({
          field: "file",
          filename: "a.pdf",
          contentType: "application/pdf",
          body: PDF,
        }),
        ifMatch: v.etag!,
      });
      expect(onVideo.status).toBe(400);
    });

    it("EARS-28: steps reorder under the lesson's If-Match and a removed step leaves the lesson", async () => {
      const { lessonId } = await draftLesson();
      const a = await step(lessonId, "video", { durationSec: 30 });
      const b = await step(lessonId, "download", { fileName: "b.pdf" });
      const lesson = await admin(h, "GET", `/lessons/${lessonId}`);
      const re = await admin(h, "PUT", `/lessons/${lessonId}/step-order`, {
        payload: { stepIds: [b.body.id, a.body.id] },
        ifMatch: lesson.etag!,
      });
      expect(re.status, JSON.stringify(re.body)).toBe(200);
      const order = await h.pool.query<{ id: string }>(
        "SELECT id FROM learning_steps WHERE lesson_id = $1 ORDER BY position",
        [lessonId],
      );
      expect(order.rows.map((r) => r.id)).toEqual([b.body.id, a.body.id]);
      const stepEtag = (
        await h.pool.query<{ version: number }>(
          "SELECT version FROM learning_steps WHERE id = $1",
          [a.body.id],
        )
      ).rows[0]!.version;
      const del = await admin(h, "DELETE", `/steps/${a.body.id}`, {
        ifMatch: `W/"${stepEtag}"`,
      });
      expect(del.status, JSON.stringify(del.body)).toBe(200);
      const left = await h.pool.query<{ id: string }>(
        "SELECT id FROM learning_steps WHERE lesson_id = $1 AND removed_at IS NULL",
        [lessonId],
      );
      expect(left.rows.map((r) => r.id)).toEqual([b.body.id]);
    });

    // ── Rules and presets (EARS-5, EARS-9, EARS-29) ───────────────────────

    it("EARS-29: an invalid rule value is refused 400 and the layer is unchanged", async () => {
      const before = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      const r = await admin<Problem>(h, "PUT", `/rules/course/${c.courseId}`, {
        payload: { values: { "test.threshold": 250 } },
        ifMatch: before.etag!,
      });
      expect(r.status).toBe(400);
      const after = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      expect(after.body.values).toEqual(before.body.values);
    });

    it("EARS-9: applying a preset to a course sets its layer to the preset's values", async () => {
      const presets = await admin<{ data: Preset[] }>(h, "GET", "/presets");
      const open = presets.body.data.find((p) => p.name === LEARNING_PRESET_SEEDS[1]!.name)!;
      const before = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      const r = await admin<Rules>(h, "POST", `/rules/course/${c.courseId}/apply-preset`, {
        payload: { presetId: open.id },
        ifMatch: before.etag!,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const after = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      expect(after.body.appliedPreset).toBe(open.name);
      const order = after.body.effective.find((e) => e.key === "order")!;
      expect(order.value).toBe("free");
      expect(order.level).toBe("course");
    });

    it("EARS-9: a preset on a lesson scope is refused 400", async () => {
      const presets = await admin<{ data: Preset[] }>(h, "GET", "/presets");
      const r = await admin<Problem>(h, "POST", `/rules/lesson/${c.lessonId}/apply-preset`, {
        payload: { presetId: presets.body.data[0]!.id },
        ifMatch: 'W/"0"',
      });
      expect(r.status).toBe(400);
      expect(r.body.errors?.map((e) => e.path)).toContain("scopeKind");
    });
  },
);

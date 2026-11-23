import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { LearningModule } from "../../src/learning/learning.module";
import {
  admin,
  answersFor,
  bootHarness,
  buildCourse,
  call,
  doctor,
  eventId,
  publish,
  type BuiltCourse,
  type BuiltLesson,
  type Harness,
  type Problem,
  setRules,
  staffSession,
  VIDEO_SEC,
} from "./harness.js";

// 024 EARS-24, EARS-30, EARS-31 (#4012) — V-9: who may change which rules,
// the presets, the change dialog's count, «keep» vs «require again» (owner
// D16), the recompute with the change as the cause, the status reason, and a
// republished changed lesson keeping earned completion.

type Rules = { layerVersion: number; values: Record<string, unknown> };
type Preview = { affectedDoctors: number; toDone: number; toNotDone: number };
type Reason = {
  ruleChangeId: string;
  scope: { kind: string; id: string };
  changed: { key: string; before: unknown; after: unknown }[];
  needed: { status: string; completionSentence: string };
};
type LessonRead = {
  lesson: { state: { status: string }; statusReason?: Reason };
};
type PathRead = {
  modules: {
    lessons: { id: string; state: { status: string }; statusReason?: Reason }[];
  }[];
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "024 learning — rules access and rule changes (e2e)",
  () => {
    let h: Harness;
    let adminOnly: string;
    let editorOnly: string;

    beforeAll(async () => {
      h = await bootHarness();
      adminOnly = await staffSession(h, ["platform_admin"]);
      editorOnly = await staffSession(h, ["learning_rules_editor"]);
    });

    afterAll(async () => {
      await h?.close();
    });

    const fact = (
      headers: Record<string, string>,
      body: Record<string, unknown>,
    ) => call<Problem>(h, "POST", "/me/learning/facts", headers, body);

    /** Watch, open, pass the exit test with `right` answers (all, or one of two). */
    async function finishLesson(
      c: BuiltLesson,
      d: { headers: Record<string, string> },
      right: "all" | "half" = "all",
    ) {
      for (const positionSec of [VIDEO_SEC / 2, VIDEO_SEC]) {
        expect(
          (
            await fact(d.headers, {
              eventId: eventId(),
              stepId: c.videoId,
              source: "web",
              kind: "position",
              data: { positionSec },
            })
          ).status,
        ).toBe(200);
        h.advanceClock(VIDEO_SEC / 2);
      }
      expect(
        (
          await fact(d.headers, {
            eventId: eventId(),
            stepId: c.downloadId,
            source: "web",
            kind: "opened",
            data: {},
          })
        ).status,
      ).toBe(200);
      const attempt = await call<{
        attemptId: string;
        questions: { id: string }[];
      }>(h, "POST", `/me/learning/tests/${c.testId}/attempts`, d.headers);
      expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);
      const answers =
        right === "all"
          ? answersFor(c, attempt.body)
          : answersFor(c, attempt.body).map((a, i) =>
              i === 0 ? a : answersFor(c, attempt.body, false)[i]!,
            );
      const submitted = await call<{ passed: boolean }>(
        h,
        "POST",
        `/me/learning/attempts/${attempt.body.attemptId}/submit`,
        d.headers,
        { answers },
      );
      expect(submitted.body.passed, JSON.stringify(submitted.body)).toBe(true);
    }

    const lessonRead = (c: BuiltCourse, headers: Record<string, string>) =>
      call<LessonRead>(h, "GET", `/learning/lessons/${c.lessonId}`, headers);
    const pathLesson = async (
      c: BuiltCourse,
      headers: Record<string, string>,
    ) =>
      (
        await call<PathRead>(
          h,
          "GET",
          `/learning/courses/${c.courseSlug}/path`,
          headers,
        )
      ).body.modules[0]!.lessons[0]!;
    const factCount = async (personId: string) =>
      Number(
        (
          await h.pool.query<{ n: string }>(
            "SELECT count(*) AS n FROM learning_facts WHERE person_id = $1",
            [personId],
          )
        ).rows[0]!.n,
      );
    const changesOf = async (scopeId: string) =>
      (
        await h.pool.query<{
          id: string;
          earned_progress: string;
          actor_sub: string | null;
          before: Record<string, unknown>;
          after: Record<string, unknown>;
          recomputed_at: Date | null;
        }>(
          "SELECT id, earned_progress, actor_sub, before, after, recomputed_at FROM learning_rule_changes WHERE scope_id = $1 ORDER BY at",
          [scopeId],
        )
      ).rows;

    /** The change's `recomputed_at` once the after-commit recompute finished. */
    async function recomputed(changeId: string): Promise<Date> {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const row = await h.pool.query<{ recomputed_at: Date | null }>(
          "SELECT recomputed_at FROM learning_rule_changes WHERE id = $1",
          [changeId],
        );
        if (row.rows[0]?.recomputed_at) return row.rows[0].recomputed_at;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`rule change ${changeId} never finished its recompute`);
    }

    /** Hold one doctor's projection lock on a course until `release` (a recompute waits on it). */
    async function holdProjection(personId: string, courseId: string) {
      const client = await h.pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `learning:${personId}:${courseId}`,
      ]);
      return async () => {
        await client.query("COMMIT");
        client.release();
      };
    }

    /** A reply, or a failure when it takes longer than `ms` (a save held by its recompute). */
    async function within<T>(ms: number, p: Promise<T>): Promise<T> {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no reply within ${ms} ms`)),
          ms,
        );
      });
      try {
        return await Promise.race([p, timeout]);
      } finally {
        clearTimeout(timer);
      }
    }

    const projectedRow = async (personId: string, itemId: string) =>
      (
        await h.pool.query<{
          status: string;
          cause_kind: string;
          cause_id: string | null;
        }>(
          "SELECT status, cause_kind, cause_id FROM learning_node_status WHERE person_id = $1 AND item_id = $2",
          [personId, itemId],
        )
      ).rows[0];

    /** Pass a lesson's exit test again with every answer right. */
    async function passAgain(
      l: BuiltLesson,
      d: { headers: Record<string, string> },
    ) {
      const attempt = await call<{
        attemptId: string;
        questions: { id: string }[];
      }>(h, "POST", `/me/learning/tests/${l.testId}/attempts`, d.headers);
      expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);
      const passed = await call<{ passed: boolean }>(
        h,
        "POST",
        `/me/learning/attempts/${attempt.body.attemptId}/submit`,
        d.headers,
        { answers: answersFor(l, attempt.body) },
      );
      expect(passed.body.passed, JSON.stringify(passed.body)).toBe(true);
    }

    const pathLessons = async (
      c: BuiltCourse,
      headers: Record<string, string>,
    ) =>
      (
        await call<PathRead>(
          h,
          "GET",
          `/learning/courses/${c.courseSlug}/path`,
          headers,
        )
      ).body.modules[0]!.lessons;

    /** A published course whose doctor finished the lesson at a 50 % pass mark. */
    async function finishedAtHalf() {
      const c = await buildCourse(h);
      expect(
        (await setRules(h, "course", c.courseId, { "test.threshold": 50 }))
          .status,
      ).toBe(200);
      const d = await doctor(h);
      await finishLesson(c, d, "half");
      expect((await lessonRead(c, d.headers)).body.lesson.state.status).toBe(
        "done",
      );
      return { c, d };
    }

    // ── EARS-30 — who may change which rules ────────────────────────────────

    it("EARS-30: a draft course's rules are changed by its editors, not by the rules editor alone", async () => {
      const c = await buildCourse(h, { publish: false });
      // The read names who may change the scope, so the editor draws it
      // editable or read-only without guessing from the course state.
      expect(
        (await admin<Rules>(h, "GET", `/rules/module/${c.moduleId}`)).body
          .authority,
      ).toBe("course-editor");
      expect(
        (
          await setRules(
            h,
            "course",
            c.courseId,
            { "test.threshold": 70 },
            { sid: adminOnly },
          )
        ).status,
      ).toBe(200);
      const refused = await setRules(
        h,
        "course",
        c.courseId,
        { "test.threshold": 60 },
        { sid: editorOnly },
      );
      expect(refused.status).toBe(403);
      expect((refused.body as Problem).errorCode).toBe(
        "PLATFORM_ADMIN_REQUIRED",
      );
      // A draft course leaves no rule-change record.
      expect(await changesOf(c.courseId)).toHaveLength(0);
    });

    it("EARS-30: a published course's rules take `learning_rules_editor`; `platform_admin` alone is refused and nothing changes", async () => {
      const c = await buildCourse(h);
      const before = await admin<Rules>(
        h,
        "GET",
        `/rules/lesson/${c.lessonId}`,
      );
      const refused = await setRules(
        h,
        "lesson",
        c.lessonId,
        { "test.threshold": 60 },
        { sid: adminOnly },
      );
      expect(refused.status).toBe(403);
      expect((refused.body as Problem).errorCode).toBe(
        "LEARNING_RULES_EDITOR_REQUIRED",
      );
      const preset = await admin<Problem>(
        h,
        "POST",
        `/rules/course/${c.courseId}/apply-preset`,
        {
          payload: { presetId: randomUUID() },
          ifMatch: 'W/"0"',
          sid: adminOnly,
        },
      );
      expect(preset.status).toBe(403);
      const after = await admin<Rules>(h, "GET", `/rules/lesson/${c.lessonId}`);
      expect(after.body.layerVersion).toBe(before.body.layerVersion);

      const ok = await setRules(
        h,
        "lesson",
        c.lessonId,
        { "test.threshold": 60 },
        { sid: editorOnly },
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });

    it("EARS-30: the platform layer takes `learning_rules_editor`", async () => {
      const current = await admin<Rules>(h, "GET", "/rules/platform/platform", {
        sid: editorOnly,
      });
      expect(current.status).toBe(200);
      expect(current.body.authority).toBe("rules-editor");
      const put = (sid: string, ifMatch: string) =>
        admin<Problem>(h, "PUT", "/rules/platform/platform", {
          payload: { values: current.body.values },
          ifMatch,
          sid,
        });
      const refused = await put(adminOnly, current.etag!);
      expect(refused.status).toBe(403);
      expect(refused.body.errorCode).toBe("LEARNING_RULES_EDITOR_REQUIRED");
      // Saving the same values is no change: no record, no recompute.
      const records = (await changesOf("platform")).length;
      const ok = await put(editorOnly, current.etag!);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await changesOf("platform")).toHaveLength(records);
    });

    it("EARS-30: a preset is read and changed by `learning_rules_editor` only, under If-Match and idempotency", async () => {
      const list = await admin<{
        data: { id: string; values: Record<string, unknown> }[];
      }>(h, "GET", "/presets", { sid: editorOnly });
      expect(list.status).toBe(200);
      const id = list.body.data[0]!.id;
      expect(
        (await admin(h, "GET", `/presets/${id}`, { sid: adminOnly })).status,
      ).toBe(403);
      const read = await admin<{
        values: Record<string, unknown>;
        version: number;
      }>(h, "GET", `/presets/${id}`, { sid: editorOnly });
      expect(read.status).toBe(200);
      const key = randomUUID();
      const put = (ifMatch: string, k = randomUUID(), sid = editorOnly) =>
        admin<{ version: number } & Problem>(h, "PUT", `/presets/${id}`, {
          payload: { values: read.body.values },
          ifMatch,
          key: k,
          sid,
        });
      expect((await put(read.etag!, undefined, adminOnly)).status).toBe(403);
      const first = await put(read.etag!, key);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.version).toBe(read.body.version + 1);
      // The same key replays the same answer; a stale version is refused.
      const replay = await put(read.etag!, key);
      expect(replay.status).toBe(200);
      expect(replay.body.version).toBe(first.body.version);
      const stale = await put(read.etag!);
      expect(stale.status).toBe(412);
      expect(stale.body.errorCode).toBe("PRECONDITION_FAILED");
      const invalid = await admin<Problem>(h, "PUT", `/presets/${id}`, {
        payload: { values: { "test.threshold": 900 } },
        ifMatch: first.etag!,
        sid: editorOnly,
      });
      expect(invalid.status).toBe(400);
    });

    it("EARS-30: a stale If-Match on a published course's rules is refused 412", async () => {
      const c = await buildCourse(h);
      const current = await admin<Rules>(
        h,
        "GET",
        `/rules/course/${c.courseId}`,
      );
      expect(
        (await setRules(h, "course", c.courseId, { "test.threshold": 60 }))
          .status,
      ).toBe(200);
      const stale = await admin<Problem>(
        h,
        "PUT",
        `/rules/course/${c.courseId}`,
        {
          payload: { values: { "test.threshold": 70 } },
          ifMatch: current.etag!,
        },
      );
      expect(stale.status).toBe(412);
    });

    // ── EARS-31 — the change dialog, keep vs require again ─────────────────

    it("EARS-31: the preview counts the doctors whose statuses would change and writes nothing", async () => {
      const { c } = await finishedAtHalf();
      const before = await admin<Rules>(
        h,
        "GET",
        `/rules/course/${c.courseId}`,
      );
      const changes = (await changesOf(c.courseId)).length;
      const preview = await admin<Preview & Problem>(
        h,
        "POST",
        `/rules/course/${c.courseId}/preview`,
        {
          payload: { values: { ...before.body.values, "test.threshold": 80 } },
        },
      );
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toEqual({
        affectedDoctors: 1,
        toDone: 0,
        toNotDone: 1,
      });
      const after = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      expect(after.body.layerVersion).toBe(before.body.layerVersion);
      expect(await changesOf(c.courseId)).toHaveLength(changes);
      // The draft editor alone may not ask about a published course either.
      const refused = await admin<Problem>(
        h,
        "POST",
        `/rules/course/${c.courseId}/preview`,
        {
          payload: { values: before.body.values },
          sid: adminOnly,
        },
      );
      expect(refused.status).toBe(403);
    });

    it("EARS-31: «keep» (the default) stores a completion-kept fact; the earned lesson stays done; one 010 row", async () => {
      const { c, d } = await finishedAtHalf();
      const facts = await factCount(d.personId);
      const saved = await setRules(h, "course", c.courseId, {
        "test.threshold": 80,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const [, change] = await changesOf(c.courseId);
      expect(change).toMatchObject({ earned_progress: "keep" });
      expect(change!.before).toMatchObject({ "test.threshold": 50 });
      expect(change!.after).toMatchObject({ "test.threshold": 80 });
      expect(change!.actor_sub).not.toBeNull();
      // The recompute follows the save (EARS-31) and finishes.
      await recomputed(change!.id);
      const kept = await h.pool.query<{
        item_ref: string;
        data: { ruleChangeId: string };
      }>(
        "SELECT item_ref, data FROM learning_facts WHERE person_id = $1 AND kind = 'completion-kept'",
        [d.personId],
      );
      expect(kept.rows.map((r) => r.item_ref)).toContain(c.lessonId);
      expect(kept.rows.every((r) => r.data.ruleChangeId === change!.id)).toBe(
        true,
      );
      // Facts only added, never changed or removed.
      expect(await factCount(d.personId)).toBe(facts + kept.rows.length);
      const read = await lessonRead(c, d.headers);
      expect(read.body.lesson.state.status).toBe("done");
      expect(read.body.lesson.statusReason).toBeUndefined();
      const audit = await h.pool.query<{ subject_id: string | null }>(
        `SELECT subject_id FROM audit_ledger
          WHERE event_type = 'data.learning_rule_changes.insert' AND metadata -> 'pk' ->> 'id' = $1`,
        [change!.id],
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.subject_id).toBe(change!.actor_sub);
    });

    it("EARS-31: applying a preset to a published course is a rule change with the author's keep / require-again choice", async () => {
      const { c, d } = await finishedAtHalf();
      const presets = await admin<{ data: { id: string; name: string }[] }>(
        h,
        "GET",
        "/presets",
      );
      const dpo = presets.body.data.find((p) => p.name === "ДПО / аккредитация")!;
      const current = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      const applied = await admin<Problem>(
        h,
        "POST",
        `/rules/course/${c.courseId}/apply-preset`,
        {
          payload: { presetId: dpo.id, earnedProgress: "require-again" },
          ifMatch: current.etag!,
          sid: editorOnly,
        },
      );
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      const change = (await changesOf(c.courseId)).at(-1)!;
      expect(change.earned_progress).toBe("require-again");
      expect(change.after).toMatchObject({ "test.threshold": 80 });
      const kept = await h.pool.query(
        "SELECT 1 FROM learning_facts WHERE person_id = $1 AND kind = 'completion-kept' AND data ->> 'ruleChangeId' = $2",
        [d.personId, change.id],
      );
      expect(kept.rows).toHaveLength(0);
    });

    it("EARS-31: a rule change whose recompute was interrupted is finished by the startup resume", async () => {
      const { c, d } = await finishedAtHalf();
      const saved = await setRules(
        h,
        "course",
        c.courseId,
        { "test.threshold": 80 },
        { earnedProgress: "require-again" },
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const change = (await changesOf(c.courseId)).at(-1)!;
      // The process stopped after COMMIT, before the recompute: the change is
      // unfinished and the doctor's projection still says what it said before.
      await h.pool.query(
        "UPDATE learning_rule_changes SET recomputed_at = NULL WHERE id = $1",
        [change.id],
      );
      await h.pool.query(
        "UPDATE learning_node_status SET status = 'done', cause_kind = 'fact', cause_id = NULL WHERE person_id = $1 AND item_id = $2",
        [d.personId, c.lessonId],
      );

      h.app.get(LearningModule).onApplicationBootstrap();

      const deadline = Date.now() + 15_000;
      let recomputed: string | null = null;
      while (Date.now() < deadline) {
        const row = await h.pool.query<{ recomputed_at: string | null }>(
          "SELECT recomputed_at FROM learning_rule_changes WHERE id = $1",
          [change.id],
        );
        recomputed = row.rows[0]!.recomputed_at;
        if (recomputed) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(recomputed).not.toBeNull();
      const projected = await h.pool.query<{
        status: string;
        cause_kind: string;
        cause_id: string;
      }>(
        "SELECT status, cause_kind, cause_id FROM learning_node_status WHERE person_id = $1 AND item_id = $2",
        [d.personId, c.lessonId],
      );
      expect(projected.rows[0]).toMatchObject({
        cause_kind: "rule-change",
        cause_id: change.id,
      });
      expect(projected.rows[0]!.status).not.toBe("done");
    });

    it("EARS-31, EARS-24: «require again» recomputes with the change as the cause; the reason shows until the doctor completes the lesson", async () => {
      const { c, d } = await finishedAtHalf();
      const facts = await factCount(d.personId);
      const saved = await setRules(
        h,
        "course",
        c.courseId,
        { "test.threshold": 80 },
        { earnedProgress: "require-again" },
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const change = (await changesOf(c.courseId)).at(-1)!;
      expect(change.earned_progress).toBe("require-again");
      expect(await factCount(d.personId)).toBe(facts);
      await recomputed(change.id);
      const projected = await h.pool.query<{
        status: string;
        cause_kind: string;
        cause_id: string;
      }>(
        "SELECT status, cause_kind, cause_id FROM learning_node_status WHERE person_id = $1 AND item_id = $2",
        [d.personId, c.lessonId],
      );
      expect(projected.rows[0]).toMatchObject({
        cause_kind: "rule-change",
        cause_id: change.id,
      });
      expect(projected.rows[0]!.status).not.toBe("done");

      const read = await lessonRead(c, d.headers);
      expect(read.body.lesson.state.status).not.toBe("done");
      const reason = read.body.lesson.statusReason!;
      expect(reason).toMatchObject({
        ruleChangeId: change.id,
        scope: { kind: "course", id: c.courseId },
        changed: [{ key: "test.threshold", before: 50, after: 80 }],
      });
      expect(reason.needed.status).toBe(read.body.lesson.state.status);
      expect(reason.needed.completionSentence).toContain("80 %");
      expect((await pathLesson(c, d.headers)).statusReason).toEqual(reason);

      // The doctor passes again at the new mark: done, and the reason is gone.
      const attempt = await call<{
        attemptId: string;
        questions: { id: string }[];
      }>(h, "POST", `/me/learning/tests/${c.testId}/attempts`, d.headers);
      if (attempt.status !== 201) {
        // The attempt pause of EARS-19 may hold; lift it for this check.
        expect(
          (
            await setRules(h, "course", c.courseId, {
              "test.pauseMin": 0,
              "test.attempts": 10,
            })
          ).status,
        ).toBe(200);
      }
      const retry =
        attempt.status === 201
          ? attempt
          : await call<{ attemptId: string; questions: { id: string }[] }>(
              h,
              "POST",
              `/me/learning/tests/${c.testId}/attempts`,
              d.headers,
            );
      expect(retry.status, JSON.stringify(retry.body)).toBe(201);
      const passed = await call<{ passed: boolean }>(
        h,
        "POST",
        `/me/learning/attempts/${retry.body.attemptId}/submit`,
        d.headers,
        { answers: answersFor(c, retry.body) },
      );
      expect(passed.body.passed).toBe(true);
      const done = await lessonRead(c, d.headers);
      expect(done.body.lesson.state.status).toBe("done");
      expect(done.body.lesson.statusReason).toBeUndefined();
      expect((await pathLesson(c, d.headers)).statusReason).toBeUndefined();
    });

    it("EARS-31: a republished changed lesson of a published course keeps the doctor's earned completion (D16)", async () => {
      const c = await buildCourse(h);
      const d = await doctor(h);
      await finishLesson(c, d);
      expect((await lessonRead(c, d.headers)).body.lesson.state.status).toBe(
        "done",
      );

      const lesson = await admin(h, "GET", `/lessons/${c.lessonId}`);
      const unpublished = await admin(
        h,
        "POST",
        `/lessons/${c.lessonId}/unpublish`,
        {
          ifMatch: lesson.etag!,
        },
      );
      expect(unpublished.status, JSON.stringify(unpublished.body)).toBe(200);
      const step = await admin<{ id: string }>(h, "POST", "/steps", {
        payload: {
          lessonId: c.lessonId,
          type: "video",
          title: "Новое видео",
          durationMin: 1,
          payload: { durationSec: VIDEO_SEC },
        },
      });
      expect(step.status, JSON.stringify(step.body)).toBe(201);
      expect(
        (
          await admin(h, "PUT", `/steps/${step.body.id}/source`, {
            payload: { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
            ifMatch: step.etag!,
          })
        ).status,
      ).toBe(200);
      const again = await admin(h, "GET", `/lessons/${c.lessonId}`);
      const republished = await admin(
        h,
        "POST",
        `/lessons/${c.lessonId}/publish`,
        {
          ifMatch: again.etag!,
        },
      );
      expect(republished.status, JSON.stringify(republished.body)).toBe(200);

      const read = await lessonRead(c, d.headers);
      expect(read.body.lesson.state.status).toBe("done");
      const kept = await h.pool.query<{ item_ref: string }>(
        "SELECT item_ref FROM learning_facts WHERE person_id = $1 AND kind = 'completion-kept'",
        [d.personId],
      );
      expect(kept.rows.map((r) => r.item_ref)).toContain(c.lessonId);
      // A doctor who never finished it is not given the completion.
      const other = await doctor(h);
      expect(
        (await lessonRead(c, other.headers)).body.lesson.state.status,
      ).not.toBe("done");
    });

    // ── EARS-24 — the reason stays until the doctor passes the lesson again ──

    /** Two lessons, both finished at a 50 % pass mark, attempts not paused. */
    async function twoFinishedAtHalf() {
      const c = await buildCourse(h, { lessons: 2 });
      expect(
        (
          await setRules(h, "course", c.courseId, {
            "test.threshold": 50,
            "test.pauseMin": 0,
            "test.attempts": 10,
          })
        ).status,
      ).toBe(200);
      const d = await doctor(h);
      for (const l of c.lessons) await finishLesson(l, d, "half");
      expect(
        (await pathLessons(c, d.headers)).map((l) => l.state.status),
      ).toEqual(["done", "done"]);
      return { c, d };
    }

    it("EARS-24: two reopened lessons — the locked one carries the reason, and re-passing the first keeps the second's reason when it opens", async () => {
      const { c, d } = await twoFinishedAtHalf();
      const saved = await setRules(
        h,
        "course",
        c.courseId,
        { "test.threshold": 80 },
        { earnedProgress: "require-again" },
      );
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const change = (await changesOf(c.courseId)).at(-1)!;
      await recomputed(change.id);

      const [first, second] = await pathLessons(c, d.headers);
      expect(first!.state.status).not.toBe("done");
      expect(first!.statusReason?.ruleChangeId).toBe(change.id);
      // The second lesson sits locked behind the first, and still says why it
      // is no longer done.
      expect(second!.state.status).toBe("locked");
      expect(second!.statusReason).toMatchObject({
        ruleChangeId: change.id,
        changed: [{ key: "test.threshold", before: 50, after: 80 }],
        needed: { status: "locked" },
      });

      // The doctor passes the first lesson again: its reason is gone, the
      // second opens and keeps its reason until it is passed again too.
      await passAgain(c.lessons[0]!, d);
      const [firstDone, secondOpen] = await pathLessons(c, d.headers);
      expect(firstDone!.state.status).toBe("done");
      expect(firstDone!.statusReason).toBeUndefined();
      expect(secondOpen!.state.status).not.toBe("locked");
      expect(secondOpen!.state.status).not.toBe("done");
      expect(secondOpen!.statusReason).toMatchObject({
        ruleChangeId: change.id,
        needed: { status: secondOpen!.state.status },
      });
      const secondRead = await call<LessonRead>(
        h,
        "GET",
        `/learning/lessons/${c.lessons[1]!.lessonId}`,
        d.headers,
      );
      expect(secondRead.body.lesson.statusReason?.ruleChangeId).toBe(change.id);

      await passAgain(c.lessons[1]!, d);
      const after = await pathLessons(c, d.headers);
      expect(after.map((l) => l.state.status)).toEqual(["done", "done"]);
      expect(after.every((l) => l.statusReason === undefined)).toBe(true);
    });

    // ── EARS-31 — the save returns after the commit; the recompute follows ──

    it("EARS-31: the save returns after its commit while the recompute waits; live reads already show the new status and the reason", async () => {
      const { c, d } = await finishedAtHalf();
      const release = await holdProjection(d.personId, c.courseId);
      let changeId = "";
      try {
        const saved = await within(
          8_000,
          setRules(
            h,
            "course",
            c.courseId,
            { "test.threshold": 80 },
            { earnedProgress: "require-again" },
          ),
        );
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const change = (await changesOf(c.courseId)).at(-1)!;
        changeId = change.id;
        // The recompute has not reached the doctor: the projection is stale…
        expect(change.recomputed_at).toBeNull();
        expect((await projectedRow(d.personId, c.lessonId))!.status).toBe(
          "done",
        );
        // …and the doctor's reads are right all the same.
        const read = await lessonRead(c, d.headers);
        expect(read.body.lesson.state.status).not.toBe("done");
        expect(read.body.lesson.statusReason?.ruleChangeId).toBe(change.id);
        expect(
          (await pathLesson(c, d.headers)).statusReason?.ruleChangeId,
        ).toBe(change.id);
      } finally {
        await release();
      }
      await recomputed(changeId);
      expect(await projectedRow(d.personId, c.lessonId)).toMatchObject({
        cause_kind: "rule-change",
        cause_id: changeId,
      });
      expect(
        (await lessonRead(c, d.headers)).body.lesson.statusReason?.ruleChangeId,
      ).toBe(changeId);
    }, 30_000);

    it("EARS-31: a change no doctor's status depends on is finished in the save itself, without walking the learners", async () => {
      const { c, d } = await finishedAtHalf();
      const current = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      const preview = await admin<Preview>(
        h,
        "POST",
        `/rules/course/${c.courseId}/preview`,
        { payload: { values: { ...current.body.values, "test.threshold": 40 } } },
      );
      expect(preview.body.affectedDoctors).toBe(0);
      // A walk would wait on this doctor's projection lock.
      const release = await holdProjection(d.personId, c.courseId);
      try {
        const saved = await within(
          8_000,
          setRules(
            h,
            "course",
            c.courseId,
            { "test.threshold": 40 },
            { earnedProgress: "require-again" },
          ),
        );
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const change = (await changesOf(c.courseId)).at(-1)!;
        expect(change.after).toMatchObject({ "test.threshold": 40 });
        expect(change.recomputed_at).not.toBeNull();
      } finally {
        await release();
      }
      expect((await lessonRead(c, d.headers)).body.lesson.state.status).toBe(
        "done",
      );
    }, 30_000);

    // ── EARS-31 — a later «require again» re-judges an earlier kept credit ──

    it("EARS-31: «keep», then «require again» on the same lesson — the kept credit no longer counts; the preview counts the doctor; the reason shows; no fact changes", async () => {
      const { c, d } = await finishedAtHalf();
      const kept = await setRules(h, "course", c.courseId, {
        "test.threshold": 80,
      });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      expect((await lessonRead(c, d.headers)).body.lesson.state.status).toBe(
        "done",
      );
      const facts = await factCount(d.personId);
      const current = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      const preview = await admin<Preview>(
        h,
        "POST",
        `/rules/course/${c.courseId}/preview`,
        { payload: { values: { ...current.body.values, "test.threshold": 90 } } },
      );
      expect(preview.status, JSON.stringify(preview.body)).toBe(200);
      expect(preview.body).toMatchObject({ affectedDoctors: 1, toNotDone: 1 });

      const again = await setRules(
        h,
        "course",
        c.courseId,
        { "test.threshold": 90 },
        { earnedProgress: "require-again" },
      );
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      const change = (await changesOf(c.courseId)).at(-1)!;
      expect(change.earned_progress).toBe("require-again");
      const read = await lessonRead(c, d.headers);
      expect(read.body.lesson.state.status).not.toBe("done");
      expect(read.body.lesson.statusReason).toMatchObject({
        ruleChangeId: change.id,
        changed: [{ key: "test.threshold", before: 80, after: 90 }],
      });
      // The kept credit is still there, unchanged — it just no longer counts.
      expect(await factCount(d.personId)).toBe(facts);
      const keptFacts = await h.pool.query(
        "SELECT 1 FROM learning_facts WHERE person_id = $1 AND kind = 'completion-kept' AND item_ref = $2",
        [d.personId, c.lessonId],
      );
      expect(keptFacts.rows.length).toBeGreaterThan(0);
      await recomputed(change.id);
      expect((await projectedRow(d.personId, c.lessonId))!.status).not.toBe(
        "done",
      );
    });

    it("EARS-31: a later «keep» leaves an earlier kept credit counting", async () => {
      const { c, d } = await finishedAtHalf();
      expect(
        (await setRules(h, "course", c.courseId, { "test.threshold": 80 }))
          .status,
      ).toBe(200);
      expect(
        (await setRules(h, "course", c.courseId, { "test.threshold": 90 }))
          .status,
      ).toBe(200);
      const read = await lessonRead(c, d.headers);
      expect(read.body.lesson.state.status).toBe("done");
      expect(read.body.lesson.statusReason).toBeUndefined();
    });

    // ── EARS-30, EARS-31 — a once-published course stays governed ──────────

    const courseState = async (
      c: BuiltCourse,
      verb: "publish" | "unpublish",
    ) => {
      const course = await admin(h, "GET", `/courses/${c.courseId}`);
      const moved = await admin(h, "POST", `/courses/${c.courseId}/${verb}`, {
        ifMatch: course.etag!,
      });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    };

    it("EARS-30: an unpublished course that was once published still takes `learning_rules_editor`; `platform_admin` alone is refused", async () => {
      const c = await buildCourse(h);
      await courseState(c, "unpublish");
      const before = await admin<Rules>(
        h,
        "GET",
        `/rules/course/${c.courseId}`,
      );
      expect(before.body.authority).toBe("rules-editor");
      const refused = await setRules(
        h,
        "course",
        c.courseId,
        { "test.threshold": 60 },
        { sid: adminOnly },
      );
      expect(refused.status).toBe(403);
      expect((refused.body as Problem).errorCode).toBe(
        "LEARNING_RULES_EDITOR_REQUIRED",
      );
      const after = await admin<Rules>(h, "GET", `/rules/course/${c.courseId}`);
      expect(after.body.layerVersion).toBe(before.body.layerVersion);
      expect(
        (
          await setRules(
            h,
            "lesson",
            c.lessonId,
            { "test.threshold": 60 },
            { sid: adminOnly },
          )
        ).status,
      ).toBe(403);
    });

    it("EARS-31: a rule change while the course is unpublished is a recorded rule change; the republished course keeps earned completion", async () => {
      const { c, d } = await finishedAtHalf();
      const changesBefore = (await changesOf(c.courseId)).length;
      await courseState(c, "unpublish");
      const saved = await setRules(h, "course", c.courseId, {
        "test.threshold": 80,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      await courseState(c, "publish");

      const changes = await changesOf(c.courseId);
      expect(changes).toHaveLength(changesBefore + 1);
      const change = changes.at(-1)!;
      expect(change).toMatchObject({ earned_progress: "keep" });
      expect(change.before).toMatchObject({ "test.threshold": 50 });
      expect(change.after).toMatchObject({ "test.threshold": 80 });
      await recomputed(change.id);
      const kept = await h.pool.query<{ item_ref: string }>(
        "SELECT item_ref FROM learning_facts WHERE person_id = $1 AND kind = 'completion-kept' AND data ->> 'ruleChangeId' = $2",
        [d.personId, change.id],
      );
      expect(kept.rows.map((r) => r.item_ref)).toContain(c.lessonId);
      expect((await lessonRead(c, d.headers)).body.lesson.state.status).toBe(
        "done",
      );
    });

    it("EARS-30: the first publish stamps first_published_at and an unpublish never clears it", async () => {
      const c = await buildCourse(h, { publish: false });
      const stamp = async () =>
        (
          await h.pool.query<{ first_published_at: Date | null }>(
            "SELECT first_published_at FROM learning_courses WHERE id = $1",
            [c.courseId],
          )
        ).rows[0]!.first_published_at;
      expect(await stamp()).toBeNull();
      await publish(h, c);
      const first = await stamp();
      expect(first).not.toBeNull();
      await courseState(c, "unpublish");
      await courseState(c, "publish");
      expect((await stamp())?.toISOString()).toBe(first!.toISOString());
    });
  },
);

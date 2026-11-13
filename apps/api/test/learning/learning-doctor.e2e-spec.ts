import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  answersFor,
  bootHarness,
  buildCourse,
  call,
  doctor,
  eventId,
  type BuiltCourse,
  type Harness,
  type Problem,
  setRules,
  VIDEO_SEC,
} from "./harness.js";

// 024 EARS-10, EARS-11, EARS-12, EARS-13, EARS-15, EARS-17, EARS-18, EARS-22
// (#4011) — the doctor side over HTTP: the public path and lesson reads, the
// gated step read, the facts intake (with its abuse cases), attempts, the
// evaluator cascade and the 025 completion fact.

type Facts = { outcome: string; changed: { itemId: string; status: string }[] };
type Attempt = { attemptId: string; questions: { id: string }[] };

describe.skipIf(!process.env.DATABASE_URL || !process.env.IDP_ISSUER)(
  "024 learning — doctor reads and progress (e2e)",
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

    const fact = (
      headers: Record<string, string>,
      body: Record<string, unknown>,
    ) => call<Facts & Problem>(h, "POST", "/me/learning/facts", headers, body);

    const position = (
      headers: Record<string, string>,
      positionSec: number,
      id = eventId(),
    ) =>
      fact(headers, {
        eventId: id,
        stepId: c.videoId,
        source: "web",
        kind: "position",
        data: { positionSec },
      });

    const storedFacts = async (personId: string, stepId: string) =>
      (
        await h.pool.query<{ data: Record<string, unknown>; occurred_at: Date }>(
          "SELECT data, occurred_at FROM learning_facts WHERE person_id = $1 AND step_id = $2 ORDER BY recorded_at",
          [personId, stepId],
        )
      ).rows;

    /** Watch the video to the end (two honest reports), open the download. */
    async function doContentSteps(headers: Record<string, string>) {
      expect((await position(headers, VIDEO_SEC / 2)).status).toBe(200);
      expect((await position(headers, VIDEO_SEC)).status).toBe(200);
      const opened = await fact(headers, {
        eventId: eventId(),
        stepId: c.downloadId,
        source: "app",
        kind: "opened",
        data: {},
      });
      expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    }

    const start = (headers: Record<string, string>, course = c) =>
      call<Attempt & Problem>(
        h,
        "POST",
        `/me/learning/tests/${course.testId}/attempts`,
        headers,
      );

    const submit = (
      headers: Record<string, string>,
      attempt: Attempt,
      right: boolean | "half",
      course = c,
    ) => {
      const answers =
        right === "half"
          ? answersFor(course, attempt).map((a, i) =>
              i === 0 ? a : answersFor(course, attempt, false)[i]!,
            )
          : answersFor(course, attempt, right);
      return call<{ score: number; passed: boolean } & Problem>(
        h,
        "POST",
        `/me/learning/attempts/${attempt.attemptId}/submit`,
        headers,
        { answers },
      );
    };

    const pointsFacts = async (personId: string, lessonId: string) =>
      (
        await h.pool.query(
          "SELECT event_id FROM points_facts WHERE person_id = $1 AND type = 'lesson.completed' AND ref_id = $2",
          [personId, lessonId],
        )
      ).rows.length;

    // ── Reads ─────────────────────────────────────────────────────────────

    it("EARS-13: a guest reads the published path with every state from no facts; an unknown or draft course is 404", async () => {
      const guest = await call<{
        signedIn: boolean;
        modules: { lessons: { steps: { id: string; state: { status: string } }[] }[] }[];
      }>(h, "GET", `/learning/courses/${c.courseSlug}/path`);
      expect(guest.status).toBe(200);
      expect(guest.body.signedIn).toBe(false);
      const steps = guest.body.modules[0]!.lessons[0]!.steps;
      expect(steps.map((s) => s.id)).toEqual([c.videoId, c.downloadId, c.testId]);
      // after-previous: only the first step is open.
      expect(steps.slice(1).every((s) => s.state.status === "locked")).toBe(true);
      expect((await call(h, "GET", "/learning/courses/no-such-course/path")).status).toBe(404);
      const draft = await buildCourse(h, { publish: false });
      expect((await call(h, "GET", `/learning/courses/${draft.courseSlug}/path`)).status).toBe(404);
    });

    it("EARS-15/17:the lesson read names its completion rule and carries no step payload", async () => {
      const res = await call<{
        lesson: { completionSentence: string };
        steps: Record<string, unknown>[];
      }>(h, "GET", `/learning/lessons/${c.lessonId}`);
      expect(res.status).toBe(200);
      expect(res.body.lesson.completionSentence).toContain("80 %");
      expect(JSON.stringify(res.body)).not.toContain("embedRef");
      expect((await call(h, "GET", "/learning/lessons/not-a-uuid")).status).toBe(404);
    });

    it("EARS-22: a guest is refused every step payload and every write with 401", async () => {
      expect((await call(h, "GET", `/me/learning/steps/${c.videoId}`)).status).toBe(401);
      expect((await position({ "user-agent": "x" }, 10)).status).toBe(401);
      expect((await start({ "user-agent": "x" })).status).toBe(401);
    });

    it("EARS-16/18:the doctor reads the open video from its provider source; a locked step is 403 with no content", async () => {
      const d = await doctor(h);
      const video = await call<{ body: Record<string, unknown> }>(
        h,
        "GET",
        `/me/learning/steps/${c.videoId}`,
        d.headers,
      );
      expect(video.status).toBe(200);
      expect(video.body.body).toMatchObject({
        type: "video",
        provider: "youtube",
        embedRef: "dQw4w9WgXcQ",
        durationSec: VIDEO_SEC,
        watchedPercent: 0,
      });
      const lockedRead = await call<Problem>(h, "GET", `/me/learning/steps/${c.downloadId}`, d.headers);
      expect(lockedRead.status).toBe(403);
      expect(lockedRead.body.errorCode).toBe("LEARNING_STEP_LOCKED");
      expect(JSON.stringify(lockedRead.body)).not.toContain("mediaUrl");
    });

    // ── Facts intake (EARS-10) ────────────────────────────────────────────

    it("EARS-10: a fact the step type does not take is 400, a locked step's fact is 403 and nothing is stored", async () => {
      const d = await doctor(h);
      const wrongKind = await fact(d.headers, {
        eventId: eventId(),
        stepId: c.videoId,
        source: "web",
        kind: "opened",
        data: {},
      });
      expect(wrongKind.status).toBe(400);
      const locked = await fact(d.headers, {
        eventId: eventId(),
        stepId: c.downloadId,
        source: "web",
        kind: "opened",
        data: {},
      });
      expect(locked.status).toBe(403);
      expect(locked.body.errorCode).toBe("LEARNING_STEP_LOCKED");
      expect(await storedFacts(d.personId, c.downloadId)).toHaveLength(0);
      expect(await storedFacts(d.personId, c.videoId)).toHaveLength(0);
    });

    it("EARS-10: a replayed event id is a duplicate per doctor; two doctors never collide on one id", async () => {
      const a = await doctor(h);
      const b = await doctor(h);
      const id = eventId();
      expect((await position(a.headers, 5, id)).body.outcome).toBe("recorded");
      expect((await position(a.headers, 5, id)).body.outcome).toBe("duplicate");
      expect((await position(b.headers, 5, id)).body.outcome).toBe("recorded");
      expect(await storedFacts(a.personId, c.videoId)).toHaveLength(1);
      expect(await storedFacts(b.personId, c.videoId)).toHaveLength(1);
    });

    it("EARS-10: an event id with the server-reserved prefix is refused with 422 and nothing is stored", async () => {
      const d = await doctor(h);
      const res = await position(d.headers, 5, `learning:attempt:${eventId()}`);
      expect(res.status).toBe(422);
      expect(res.body.errorCode).toBe("EVENT_ID_RESERVED");
      expect(await storedFacts(d.personId, c.videoId)).toHaveLength(0);
    });

    it("EARS-10: the server sets the time and clamps a forged position — the step is not done", async () => {
      const d = await doctor(h);
      const before = Date.now();
      const res = await fact(d.headers, {
        eventId: eventId(),
        stepId: c.videoId,
        source: "web",
        kind: "position",
        clientOccurredAt: "2020-01-01T00:00:00Z",
        data: { positionSec: 600 },
      });
      expect(res.status).toBe(200);
      const [row] = await storedFacts(d.personId, c.videoId);
      // The first report gets the slack only (`progress.slackSec`, seeded 30).
      expect(row!.data).toMatchObject({ reportedSec: 600, positionSec: 30, clientOccurredAt: "2020-01-01T00:00:00Z" });
      expect(row!.occurred_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
      const read = await call<{ body: { watchedPercent: number }; step: { state: { status: string } } }>(
        h,
        "GET",
        `/me/learning/steps/${c.videoId}`,
        d.headers,
      );
      expect(read.body.body.watchedPercent).toBe(50);
      expect(read.body.step.state.status).not.toBe("done");
    });

    // ── The cascade and 025 (EARS-11, EARS-12, EARS-18) ───────────────────

    it("EARS-11/12:content steps → test passed → lesson done records one 025 lesson.completed fact", async () => {
      const d = await doctor(h);
      await doContentSteps(d.headers);
      const attempt = await start(d.headers);
      expect(attempt.status).toBe(201);
      expect(JSON.stringify(attempt.body)).not.toContain("correct");
      const result = await submit(d.headers, attempt.body, true);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ score: 100, passed: true });
      const path = await call<{ modules: { lessons: { id: string; state: { status: string } }[] }[]; course: { state: { status: string } } }>(
        h,
        "GET",
        `/learning/courses/${c.courseSlug}/path`,
        d.headers,
      );
      expect(path.body.modules[0]!.lessons[0]!.state.status).toBe("done");
      expect(path.body.course.state.status).toBe("done");
      expect(await pointsFacts(d.personId, c.lessonId)).toBe(1);
    });

    it("EARS-12: a reversal by a rule change records nothing; re-completion is a 025 duplicate", async () => {
      const course = await buildCourse(h);
      const d = await doctor(h);
      const at = (s: number) =>
        fact(d.headers, { eventId: eventId(), stepId: course.videoId, source: "web", kind: "position", data: { positionSec: s } });
      expect((await setRules(h, "course", course.courseId, { "test.threshold": 50 })).status).toBe(200);
      await at(VIDEO_SEC / 2);
      await at(VIDEO_SEC);
      await fact(d.headers, { eventId: eventId(), stepId: course.downloadId, source: "web", kind: "opened", data: {} });
      const attempt = await start(d.headers, course);
      expect((await submit(d.headers, attempt.body, "half", course)).body).toMatchObject({ score: 50, passed: true });
      expect(await pointsFacts(d.personId, course.lessonId)).toBe(1);

      // The threshold rises: the next fact re-evaluates the lesson as not done.
      expect((await setRules(h, "course", course.courseId, { "test.threshold": 80 })).status).toBe(200);
      const reversed = await at(VIDEO_SEC);
      expect(reversed.body.changed.find((x) => x.itemId === course.lessonId)?.status).not.toBe("done");
      expect(await pointsFacts(d.personId, course.lessonId)).toBe(1);

      // It falls again: done again, and the 025 fact is the same one.
      expect((await setRules(h, "course", course.courseId, { "test.threshold": 50 })).status).toBe(200);
      const again = await at(VIDEO_SEC);
      expect(again.body.changed.find((x) => x.itemId === course.lessonId)?.status).toBe("done");
      expect(await pointsFacts(d.personId, course.lessonId)).toBe(1);
    });

    it("EARS-5: the resolver takes the nearest layer — lesson over course over platform", async () => {
      const course = await buildCourse(h);
      const sentence = async () =>
        (await call<{ lesson: { completionSentence: string } }>(h, "GET", `/learning/lessons/${course.lessonId}`)).body.lesson.completionSentence;
      expect(await sentence()).toContain("80 %");
      expect((await setRules(h, "course", course.courseId, { "test.threshold": 60 })).status).toBe(200);
      expect(await sentence()).toContain("60 %");
      expect((await setRules(h, "lesson", course.lessonId, { "test.threshold": 90 })).status).toBe(200);
      expect(await sentence()).toContain("90 %");
      const rules = await admin<{ effective: { key: string; value: unknown }[] }>(h, "GET", `/rules/course/${course.courseId}`);
      expect(rules.body.effective.find((e) => e.key === "test.threshold")?.value).toBe(60);
    });

    // ── Attempts (EARS-18) ────────────────────────────────────────────────

    it("EARS-18: an open attempt is returned again, never redrawn; every started attempt counts toward the limit", async () => {
      const course = await buildCourse(h);
      expect((await setRules(h, "course", course.courseId, { "test.attempts": 1 })).status).toBe(200);
      const d = await doctor(h);
      await call(h, "POST", "/me/learning/facts", d.headers, { eventId: eventId(), stepId: course.videoId, source: "web", kind: "position", data: { positionSec: 30 } });
      await call(h, "POST", "/me/learning/facts", d.headers, { eventId: eventId(), stepId: course.videoId, source: "web", kind: "position", data: { positionSec: 60 } });
      await call(h, "POST", "/me/learning/facts", d.headers, { eventId: eventId(), stepId: course.downloadId, source: "web", kind: "opened", data: {} });
      const first = await start(d.headers, course);
      const again = await start(d.headers, course);
      expect(again.status).toBe(201);
      expect(again.body.attemptId).toBe(first.body.attemptId);
      expect(again.body.questions.map((q) => q.id)).toEqual(first.body.questions.map((q) => q.id));
      expect((await submit(d.headers, first.body, false, course)).body.passed).toBe(false);
      const refused = await start(d.headers, course);
      expect(refused.status).toBe(409);
      expect(refused.body.errorCode).toBe("LEARNING_ATTEMPT_UNAVAILABLE");
      const submittedTwice = await submit(d.headers, first.body, true, course);
      expect(submittedTwice.status).toBe(409);
    });

    it("EARS-18: submit re-checks the limit and the pause under the lock; a refused submit stores nothing", async () => {
      const course = await buildCourse(h);
      const d = await doctor(h);
      for (const [s, kind, step] of [[30, "position", course.videoId], [60, "position", course.videoId], [0, "opened", course.downloadId]] as const) {
        await call(h, "POST", "/me/learning/facts", d.headers, { eventId: eventId(), stepId: step, source: "web", kind, data: kind === "position" ? { positionSec: s } : {} });
      }
      const a = await start(d.headers, course);
      await submit(d.headers, a.body, false, course);
      const b = await start(d.headers, course);
      expect(b.status).toBe(201);
      // The rules tighten while attempt B is open.
      expect((await setRules(h, "course", course.courseId, { "test.attempts": 1 })).status).toBe(200);
      const late = await submit(d.headers, b.body, true, course);
      expect(late.status).toBe(409);
      expect(late.body.errorCode).toBe("LEARNING_ATTEMPT_UNAVAILABLE");
      const { rows } = await h.pool.query(
        "SELECT 1 FROM learning_facts WHERE person_id = $1 AND kind = 'attempt-submitted' AND data ->> 'attemptId' = $2",
        [d.personId, b.body.attemptId],
      );
      expect(rows).toHaveLength(0);

      // A pause set while B is open: B's submit falls inside A's pause, and
      // the refusal says when the next attempt opens.
      expect((await setRules(h, "course", course.courseId, { "test.attempts": "unlimited", "test.pauseMin": 60 })).status).toBe(200);
      const paused = await submit(d.headers, b.body, true, course);
      expect(paused.status).toBe(409);
      expect(paused.body.nextAt).toEqual(expect.any(String));
      // Lifted, the same open attempt submits.
      expect((await setRules(h, "course", course.courseId, { "test.pauseMin": 0 })).status).toBe(200);
      expect((await submit(d.headers, b.body, true, course)).body.passed).toBe(true);
    });
  },
);

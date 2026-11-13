import { describe, expect, it } from "vitest";
import {
  applyPresetValues,
  conditionType,
  elementType,
  evaluateCourse,
  LEARNING_ELEMENT_CATALOG,
  LEARNING_PLATFORM_SCOPE_ID,
  LEARNING_PLATFORM_SEED,
  LEARNING_PRESET_NAMES,
  LEARNING_PRESET_SEEDS,
  LearningLayers,
  type LearningCourseModel,
  type LearningFactModel,
  type LearningLayer,
  publishRequirements,
  validateRuleTree,
  validateSettingValues,
  validateStepPayload,
  EMPTY_RULE_SCOPE,
} from "./index.js";
import { LearningPlatformValuesSchema, type LearningSettingValues } from "@ds/schemas";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SCHOOL = id(1);
const COURSE = id(2);
const M1 = id(10);
const M2 = id(11);
const L1 = id(20);
const L2 = id(21);
const L3 = id(22);
const S_VIDEO = id(30);
const S_DOWNLOAD = id(31);
const S_TEST = id(32);
const S2_VIDEO = id(33);
const S2_TEST = id(34);
const S3_VIDEO = id(35);
const S3_TEST = id(36);

const video = (sid: string) => ({
  id: sid,
  type: "video" as const,
  title: "Видео",
  durationMin: 10,
  payload: { durationSec: 600 },
});
const exitTest = (sid: string) => ({ id: sid, type: "test" as const, title: "Тест", durationMin: 5, payload: { kind: "exit" } });

const COURSE_MODEL: LearningCourseModel = {
  id: COURSE,
  schoolId: SCHOOL,
  modules: [
    {
      id: M1,
      title: "Модуль 1",
      lessons: [
        {
          id: L1,
          title: "Урок 1",
          steps: [
            video(S_VIDEO),
            { id: S_DOWNLOAD, type: "download", title: "Материал", durationMin: 3, payload: { fileName: "f.pdf" } },
            exitTest(S_TEST),
          ],
        },
        { id: L2, title: "Урок 2", steps: [video(S2_VIDEO), exitTest(S2_TEST)] },
      ],
    },
    { id: M2, title: "Модуль 2", lessons: [{ id: L3, title: "Урок 3", steps: [video(S3_VIDEO), exitTest(S3_TEST)] }] },
  ],
};

function layers(...extra: LearningLayer[]): LearningLayers {
  return new LearningLayers([
    { scopeKind: "platform", scopeId: LEARNING_PLATFORM_SCOPE_ID, values: LEARNING_PLATFORM_SEED, preset: null },
    ...extra,
  ]);
}

const NOW = new Date("2026-11-13T10:00:00Z");

function lessonOneDone(): LearningFactModel[] {
  return [
    { kind: "position", stepId: S_VIDEO, positionSec: 600 },
    { kind: "opened", stepId: S_DOWNLOAD },
    { kind: "attempt-submitted", stepId: S_TEST, score: 90 },
  ];
}

function run(facts: LearningFactModel[], l = layers()) {
  return evaluateCourse({ course: COURSE_MODEL, layers: l, facts, now: NOW });
}

describe("024 learning model", () => {
  it("EARS-2: when a step names a type the element catalog does not declare, system shall refuse it with a field error", () => {
    expect(Object.keys(LEARNING_ELEMENT_CATALOG).sort()).toEqual(["download", "test", "video"]);
    expect(elementType("podcast-x")).toBeUndefined();
    const refused = validateStepPayload("hologram", {});
    expect(refused).toEqual({ ok: false, issues: [{ path: "type", message: expect.stringContaining("hologram") }] });
    expect(validateStepPayload("video", { durationSec: 60 }).ok).toBe(true);
    // Media ride the 012 media contract (an uploaded object), never a client URL.
    const urlPayload = validateStepPayload("video", { videoUrl: "https://cdn.example/v.mp4", durationSec: 60 });
    expect(urlPayload.ok).toBe(false);
    expect(LEARNING_ELEMENT_CATALOG.video.media?.contentTypes).toContain("video/mp4");
    expect(LEARNING_ELEMENT_CATALOG.download.media?.contentTypes).toContain("application/pdf");
    expect(LEARNING_ELEMENT_CATALOG.test.media).toBeNull();
    // «viewed» defaults: video to the setting's 100 %, download opened once, test at its threshold.
    expect(LEARNING_PLATFORM_SEED["viewed.video.percent"]).toBe(100);
    const watched = run([{ kind: "position", stepId: S_VIDEO, positionSec: 599 }]);
    expect(watched.evaluation.states.get(S_VIDEO)?.status).not.toBe("done");
    expect(run([{ kind: "position", stepId: S_VIDEO, positionSec: 600 }]).evaluation.states.get(S_VIDEO)?.status).toBe("done");
  });

  it("EARS-3: when a rule names a condition the catalog does not declare, system shall refuse the rule", () => {
    for (const name of ["viewed", "watched-at-least", "opened", "listened-at-least", "test-passed", "club-attended", "manual-mark", "all-steps-done", "lessons-done"]) {
      expect(conditionType(name)?.type).toBe(name);
    }
    expect(conditionType("paid")).toBeUndefined();
    const issues = validateRuleTree({ all: [{ condition: "paid" }] }, "lesson", EMPTY_RULE_SCOPE);
    expect(issues).toEqual([{ path: "all.0.condition", message: expect.stringContaining("paid") }]);
  });

  it("EARS-5: system shall resolve each setting from the nearest layer holding it, skipping layers with no row, with its level and preset", () => {
    const l = layers(
      { scopeKind: "school", scopeId: SCHOOL, values: { "test.threshold": 70 }, preset: null },
      { scopeKind: "course", scopeId: COURSE, values: { order: "free" }, preset: LEARNING_PRESET_NAMES.open },
      { scopeKind: "lesson", scopeId: L1, values: { "test.threshold": 90 }, preset: null },
    );
    const path = { school: SCHOOL, course: COURSE, module: M1, lesson: L1, step: S_TEST };
    expect(l.resolve("test.threshold", path)).toEqual({ key: "test.threshold", value: 90, level: "lesson", preset: null });
    expect(l.resolve("test.threshold", { ...path, lesson: L2, step: S2_TEST })).toMatchObject({ value: 70, level: "school" });
    expect(l.resolve("order", path)).toEqual({ key: "order", value: "free", level: "course", preset: LEARNING_PRESET_NAMES.open });
    expect(l.resolve("repeat.allowed", path)).toMatchObject({ value: true, level: "platform", preset: null });
    // The platform seed holds every key, so resolution always ends in a value.
    expect(LearningPlatformValuesSchema.safeParse(LEARNING_PLATFORM_SEED).success).toBe(true);
  });

  it("EARS-6: when a completion rule fails validation, system shall refuse it with field errors; the defaults complete steps, lessons, modules and the course", () => {
    const scope = { stepIds: new Set([S_VIDEO]), moduleIds: new Set<string>(), testStepIds: new Set<string>() };
    expect(validateRuleTree({ nOf: { n: 3, of: [{ condition: "opened" }, { condition: "viewed" }] } }, "step", scope)).toEqual([
      { path: "nOf.n", message: "n is between 1 and 2" },
    ]);
    expect(validateRuleTree({ condition: "viewed", step: S_TEST }, "step", scope)[0]?.path).toBe("step");
    const deep = { all: [{ all: [{ all: [{ all: [{ condition: "viewed" }] }] }] }] };
    expect(validateRuleTree(deep, "step", scope)[0]?.message).toContain("at most 4");
    expect(validateRuleTree({ condition: "lessons-done" }, "step", scope)[0]?.path).toBe("condition");
    expect(validateSettingValues({ "completion.lesson": { any: [{ condition: "all-steps-done" }] } }, "course", scope)).toMatchObject({ ok: true });

    const { evaluation } = run(lessonOneDone());
    expect(evaluation.states.get(L1)?.status).toBe("done");
    expect(evaluation.states.get(M1)?.status).not.toBe("done");
    // Without the exit test passed (exitRequired on) the lesson is not done.
    const noTest = run(lessonOneDone().slice(0, 2)).evaluation;
    expect(noTest.states.get(L1)?.status).not.toBe("done");
    // Exit test switched off on the course and removed from the lesson → steps only.
    const off = layers({ scopeKind: "course", scopeId: COURSE, values: { "test.exitRequired": false }, preset: null });
    const all = [
      ...lessonOneDone(),
      { kind: "position", stepId: S2_VIDEO, positionSec: 600 },
      { kind: "attempt-submitted", stepId: S2_TEST, score: 100 },
      { kind: "position", stepId: S3_VIDEO, positionSec: 600 },
      { kind: "attempt-submitted", stepId: S3_TEST, score: 80 },
    ] satisfies LearningFactModel[];
    const done = run(all, off).evaluation;
    expect(done.states.get(M1)?.status).toBe("done");
    expect(done.states.get(COURSE)?.status).toBe("done");
    expect(done.document.status).toBe("done");
  });

  it("EARS-7: system shall apply unlock after-previous, from-date and expression, and free order inside a module", () => {
    const strict = run([]).evaluation;
    expect(strict.states.get(S_VIDEO)?.status).toBe("current");
    expect(strict.states.get(S_DOWNLOAD)).toEqual({ status: "locked", reason: { kind: "previous" } });
    expect(strict.states.get(L2)).toEqual({ status: "locked", reason: { kind: "previous" } });
    expect(strict.states.get(M2)).toEqual({ status: "locked", reason: { kind: "previous" } });

    const free = run([], layers({ scopeKind: "module", scopeId: M1, values: { order: "free" }, preset: null })).evaluation;
    expect(free.states.get(S_DOWNLOAD)?.status).toBe("open");
    expect(free.states.get(L2)?.status).toBe("open");
    expect(free.states.get(M2)?.status).toBe("locked");

    const dated = layers({ scopeKind: "lesson", scopeId: L1, values: { unlock: { kind: "from-date", instant: "2026-12-01T00:00:00Z" } }, preset: null });
    expect(run([], dated).evaluation.states.get(S_VIDEO)).toEqual({
      status: "locked",
      reason: { kind: "date", at: "2026-12-01T00:00:00.000Z" },
    });

    const expr = layers({
      scopeKind: "module",
      scopeId: M2,
      values: { unlock: { kind: "expression", rule: { condition: "opened", step: S_DOWNLOAD } } },
      preset: null,
    });
    expect(run([], expr).evaluation.states.get(M2)).toEqual({ status: "locked", reason: { kind: "expression" } });
    expect(run([{ kind: "opened", stepId: S_DOWNLOAD }], expr).evaluation.states.get(M2)?.status).toBe("open");
  });

  it("EARS-8: system shall offer the test, test-out, repeat and course settings with their platform seed", () => {
    expect(LEARNING_PLATFORM_SEED).toMatchObject({
      "test.threshold": 80,
      "test.attempts": "unlimited",
      "test.pauseMin": 0,
      "test.exitRequired": true,
      "test.entryRequired": false,
      "test.entryCounts": false,
      "testOut.allowed": false,
      "repeat.allowed": true,
      "course.deliveryMode": "online",
      "course.moduleSize": 6,
      "course.closingClub": true,
      "course.clubInCompletion": false,
    });
    expect(validateSettingValues({ "course.deliveryMode": "online" }, "module", EMPTY_RULE_SCOPE)).toMatchObject({ ok: false });
    expect(validateSettingValues({ "test.threshold": 101 }, "lesson", EMPTY_RULE_SCOPE)).toMatchObject({ ok: false });
    expect(validateSettingValues({ "test.attempts": 3, "test.pauseMin": 30 }, "lesson", EMPTY_RULE_SCOPE)).toMatchObject({ ok: true });
  });

  it("EARS-9: system shall seed three presets with the exit test required, and applying one shall merge only the keys it names", () => {
    expect(LEARNING_PRESET_SEEDS.map((p) => p.name)).toEqual(["Путь (Duolingo)", "Открытый курс", "ДПО / аккредитация"]);
    for (const p of LEARNING_PRESET_SEEDS) {
      expect(p.values["test.exitRequired"]).toBe(true);
      expect(validateSettingValues(p.values, "course", EMPTY_RULE_SCOPE).ok).toBe(true);
    }
    expect(LEARNING_PRESET_SEEDS[0]!.values).toMatchObject({ "testOut.allowed": true, order: "strict" });
    expect(LEARNING_PRESET_SEEDS[2]!.values).toMatchObject({ "testOut.allowed": false, "test.entryRequired": true, "test.threshold": 80 });
    const current: LearningSettingValues = { "course.deliveryMode": "offline", order: "free" };
    const applied = applyPresetValues(current, LEARNING_PRESET_SEEDS[0]!.values);
    expect(applied).toMatchObject({ "course.deliveryMode": "offline", order: "strict", "testOut.allowed": true });
  });

  it("EARS-11: system shall compute done, current, open and locked with one evaluator from facts and resolved rules", () => {
    const { evaluation } = run(lessonOneDone());
    expect(evaluation.states.get(S_VIDEO)?.status).toBe("done");
    expect(evaluation.states.get(L1)?.status).toBe("done");
    expect(evaluation.current).toEqual({ stepId: S2_VIDEO, lessonId: L2 });
    expect(evaluation.states.get(S2_VIDEO)?.status).toBe("current");
    expect(evaluation.states.get(L2)?.status).toBe("current");
    expect(evaluation.states.get(M1)?.status).toBe("current");
    expect(evaluation.states.get(COURSE)?.status).toBe("current");
    expect(evaluation.states.get(S2_TEST)).toEqual({ status: "locked", reason: { kind: "previous" } });
    expect(evaluation.clubs.get(M1)).toEqual({ status: "locked", reason: { kind: "previous" } });
    // A failed attempt does not complete the test step.
    const failed = run([...lessonOneDone().slice(0, 2), { kind: "attempt-submitted", stepId: S_TEST, score: 60 }]).evaluation;
    expect(failed.states.get(S_TEST)?.status).toBe("current");
    // A completion-kept fact satisfies its item directly.
    expect(run([{ kind: "completion-kept", itemId: L1 }]).evaluation.states.get(L1)?.status).toBe("done");
  });

  it("EARS-17: system shall build each step's and lesson's completion sentence from its resolved rule", () => {
    const { evaluator } = run([]);
    expect(evaluator.sentence({ kind: "step", id: S_VIDEO })).toBe("Шаг засчитывается, когда видео просмотрено на 100 %");
    expect(evaluator.sentence({ kind: "step", id: S_DOWNLOAD })).toBe("Шаг засчитывается, когда материал открыт");
    expect(evaluator.sentence({ kind: "lesson", id: L1 })).toBe(
      "Урок засчитывается, когда пройдены все шаги и тест сдан не ниже 80 %",
    );
    const changed = run([], layers({ scopeKind: "course", scopeId: COURSE, values: { "test.threshold": 70, "viewed.video.percent": 90 }, preset: null })).evaluator;
    expect(changed.sentence({ kind: "lesson", id: L1 })).toBe("Урок засчитывается, когда пройдены все шаги и тест сдан не ниже 70 %");
    expect(changed.sentence({ kind: "step", id: S_VIDEO })).toBe("Шаг засчитывается, когда видео просмотрено на 90 %");
    const off = run([], layers({ scopeKind: "course", scopeId: COURSE, values: { "test.exitRequired": false }, preset: null })).evaluator;
    expect(off.sentence({ kind: "lesson", id: L1 })).toBe("Урок засчитывается, когда пройдены все шаги");
    for (const preset of LEARNING_PRESET_SEEDS) {
      const s = run([], layers({ scopeKind: "course", scopeId: COURSE, values: preset.values, preset: preset.name })).evaluator;
      expect(s.sentence({ kind: "lesson", id: L1 })).toBe("Урок засчитывается, когда пройдены все шаги и тест сдан не ниже 80 %");
    }
  });

  it("EARS-4: when a lesson misses a step, a payload or a required test, system shall name each missing item", () => {
    const l = layers();
    const path = { school: SCHOOL, course: COURSE, module: M1, lesson: L1 };
    const withMedia = () => true;
    expect(publishRequirements({ id: L1, title: "", steps: [] }, l, path, () => ({}), withMedia).map((i) => i.path)).toEqual(["steps", "exitTest"]);
    const lesson = COURSE_MODEL.modules[0]!.lessons[0]!;
    const stored = (sid: string) =>
      sid === S_TEST
        ? { kind: "exit", questions: [{ text: "?", options: [{ text: "a", correct: true }, { text: "b", correct: false }] }] }
        : lesson.steps.find((s) => s.id === sid)!.payload;
    expect(publishRequirements(lesson, l, path, stored, withMedia)).toEqual([]);
    // A video or download step with no uploaded media is not whole.
    expect(publishRequirements(lesson, l, path, stored, (sid) => sid !== S_DOWNLOAD).map((i) => i.path)).toEqual(["steps.1.media"]);
    const entry = layers({ scopeKind: "course", scopeId: COURSE, values: { "test.entryRequired": true }, preset: null });
    expect(publishRequirements(lesson, entry, path, stored, withMedia).map((i) => i.path)).toEqual(["entryTest"]);
  });

  it("EARS-26: the rule sentences and lock reasons carry no money or «бесплатно» wording", async () => {
    const { LEARNING_COPY_RU } = await import("./copy/learning-copy-ru.js");
    const text = JSON.stringify(LEARNING_COPY_RU, (_k, v) => (typeof v === "function" ? String(v) : v)).toLowerCase();
    for (const banned of ["бесплат", "оплат", "деньг", "рубл", "проект", "₽"]) expect(text).not.toContain(banned);
  });
});

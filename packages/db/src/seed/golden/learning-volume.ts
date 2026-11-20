// 023 EARS-5 (#4017) — the golden schools at volume.
//
// A staging slot runs only `seed:golden`, and the one golden school carries one
// course, so a slot could not show the school screen the owner approved at the
// canvas volume switch (`design-source/doctor-school.dc.html` 3 / 22 / 62):
// cards up to six, rows past six, «Показать ещё 10», «Найти курс». These four
// published schools carry 3, 22, 62 and 200 published courses.
//
// Each course is what the admin path writes for a small course (`learning.ts`
// names the mapping): one module of one to six published lessons, each lesson a
// download (the golden memo — no new media object) then a video (the golden
// course's provider source), and a course rule layer with own values that
// completes a lesson on its steps alone. That layer is what makes these lessons
// publishable without an exit test (EARS-4 publish requirements, held by
// `packages/learning/src/golden-school-volume.test.ts`).
//
// The verified golden doctor and its worker-pool copies (`ids.ts`) carry facts
// on the 22 / 62 / 200 schools — course 3 two lessons in, course 4 one download
// opened, course 5 finished — so a signed-in walk sees «Вы учитесь» with
// «Продолжить — урок N →» and «Завершено». Facts are rows of the append-only
// `learning_facts`; the plan inserts them once and never updates them
// (`plan.ts`). The status projection (`learning_node_status`) is rebuildable
// and is not seeded: the doctor's next real fact projects it.
//
// Course 2 of every school opens with a download and course 6 is ONE lesson of
// ONE download: `apps/doctor/e2e/school-volume-live.spec.ts` makes a fresh
// doctor start the one and finish the other through the real fact endpoint.

import type {
  learningCourses,
  learningFacts,
  learningLessons,
  learningModules,
  learningOptions,
  learningQuestions,
  learningSchools,
  learningSteps,
  learningTests,
} from "../../schema/learning.js";
import {
  golden,
  goldenLearningVolumeCourseSlug,
  goldenLearningVolumeOrdinal,
  goldenUuid,
  GOLDEN_GROUP,
} from "./ids.js";
import {
  goldenCourseMemoPdf,
  GOLDEN_COURSE_MEMO_CONTENT_TYPE,
  GOLDEN_COURSE_MEMO_KEY,
} from "./learning.js";
import { buildGoldenLearningPathVolume } from "./learning-path-volume.js";
import { goldenDirectionId, goldenPartnerId } from "./volume.js";

/** A course rule layer with its own values and no preset (`setLayerValues`). */
export interface GoldenLearningOwnLayer {
  id: string;
  scopeKind: "course";
  scopeId: string;
  values: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The volume courses' own rule values: a lesson is done when its steps are, a
 * module when its lessons are (no club), and no exit test is required — the
 * platform seed requires one, and these lessons carry none.
 */
export const GOLDEN_VOLUME_COURSE_RULES: Readonly<Record<string, unknown>> =
  Object.freeze({
    "test.exitRequired": false,
    "completion.lesson": { condition: "all-steps-done" },
    "completion.module": { condition: "lessons-done" },
  });

interface VolumeSchoolSpec {
  direction: string;
  title: string;
  description: string;
  facts: { label: string; text: string }[];
  topics: readonly string[];
}

const ORTHOBIOLOGY = [
  "Ортобиология. Базовый курс",
  "PRP-терапия в амбулаторной практике",
  "Ортобиология. Продвинутый курс",
  "BMAC: концентрат костного мозга",
  "Тендинопатии: диагностика и лечение",
  "Хрящевые дефекты коленного сустава",
  "Гонартроз: консервативное лечение",
  "Ортобиология тазобедренного сустава",
  "Реабилитация после пластики ПКС",
  "Спортивная травма плеча",
  "Латеральный эпикондилит",
  "Подошвенный фасциит",
  "Остеоартрит суставов кисти",
  "Жировая ткань как источник клеток",
  "УЗИ-навигация внутрисуставных инъекций",
  "Ахиллова тендинопатия",
  "Повреждения мениска",
  "Биомеханика бега",
  "Остеохондрит у подростков",
  "Связки голеностопного сустава",
  "Ротаторная манжета плеча",
  "Безопасность клеточных продуктов",
] as const;

const NEUROLOGY = [
  "Мигрень: профилактическая терапия",
  "Головная боль напряжения",
  "Ишемический инсульт: первые часы",
  "Вторичная профилактика инсульта",
  "Транзиторная ишемическая атака",
  "Эпилепсия у взрослых",
  "Рассеянный склероз: ведение пациента",
  "Болезнь Паркинсона: ранняя стадия",
  "Деменция: дифференциальный диагноз",
  "Полинейропатии",
  "Невропатическая боль",
  "Боль в спине: красные флаги",
  "Радикулопатия поясничного отдела",
  "Головокружение в практике невролога",
  "Нарушения сна",
  "Синдром беспокойных ног",
  "Тремор: диагностика",
  "Миастения",
  "Невралгия тройничного нерва",
  "Паралич Белла",
  "Синдром запястного канала",
  "Черепно-мозговая травма лёгкой степени",
  "Когнитивные нарушения после инсульта",
  "Спастичность: ботулинотерапия",
  "Нейровизуализация для невролога",
  "Неврологический осмотр за 10 минут",
  "Хроническая ежедневная головная боль",
  "Тревога и депрессия у неврологического пациента",
  "Энцефалопатии",
  "Нейроинфекции",
  "Реабилитация после инсульта",
] as const;

const THERAPY = [
  "Артериальная гипертензия у пожилых",
  "Хроническая сердечная недостаточность",
  "Фибрилляция предсердий: антикоагуляция",
  "Дислипидемия: целевые уровни",
  "Сахарный диабет 2 типа в практике терапевта",
  "Хроническая болезнь почек",
  "Анемии: дифференциальный диагноз",
  "Внебольничная пневмония",
  "Бронхиальная астма",
  "ХОБЛ: базисная терапия",
  "Хронический кашель",
  "Язвенная болезнь",
  "Неалкогольная жировая болезнь печени",
  "Синдром раздражённого кишечника",
  "Остеопороз: профилактика переломов",
  "Подагра",
  "Ревматоидный артрит: ранняя диагностика",
  "Остеоартрит в практике терапевта",
  "Гипотиреоз",
  "Ожирение: медикаментозная терапия",
  "Боль в груди: алгоритм",
  "Одышка: алгоритм обследования",
  "Отёки: дифференциальный диагноз",
  "Лихорадка неясного генеза",
  "Инфекции мочевыводящих путей",
  "Антибиотикотерапия в амбулаторной практике",
  "Вакцинация взрослых",
  "Полипрагмазия у пожилых",
  "Синкопальные состояния",
  "Тромбоэмболия лёгочной артерии",
  "Венозные тромбозы",
  "Хроническая боль в практике терапевта",
  "Депрессия в первичном звене",
  "Нарушения ритма: ЭКГ для терапевта",
  "Профилактический осмотр взрослых",
  "Диспансерное наблюдение",
  "Железодефицит без анемии",
  "Дефицит витамина D",
  "Аллергический ринит",
  "Крапивница",
] as const;

/** A course title past the first round of topics: the topic plus its format. */
const FORMATS = [
  "",
  ": клинические разборы",
  " в амбулаторной практике",
  ": новые рекомендации",
  ": сложные случаи",
] as const;

const VOLUME_SCHOOLS: readonly VolumeSchoolSpec[] = [
  {
    direction: "endocrinology",
    title: "Школа эндокринологии",
    description:
      "Школа о диабете, болезнях щитовидной железы и ожирении для врачей первичного звена.",
    facts: [
      { label: "Формат", text: "Видеолекции и памятки" },
      { label: "Для кого", text: "Терапевты и эндокринологи" },
    ],
    topics: [
      "Сахарный диабет 2 типа: старт терапии",
      "Гипотиреоз в амбулаторной практике",
      "Ожирение: медикаментозная терапия",
    ],
  },
  {
    direction: "traumatology",
    title: "Школа ортобиологии",
    description:
      "Регенеративные методы в травматологии и спортивной медицине: от показаний до протоколов.",
    facts: [
      { label: "Формат", text: "Видеолекции, памятки и разборы" },
      { label: "Для кого", text: "Травматологи-ортопеды и спортивные врачи" },
      { label: "Практика", text: "Протоколы инъекций под УЗИ-навигацией" },
    ],
    topics: ORTHOBIOLOGY,
  },
  {
    direction: "neurology",
    title: "Школа неврологии",
    description:
      "Головная боль, инсульт, нейродегенеративные болезни и боль в спине — для неврологов и терапевтов.",
    facts: [
      { label: "Формат", text: "Видеолекции и клинические разборы" },
      { label: "Для кого", text: "Неврологи и терапевты" },
      { label: "Документ", text: "Сертификат по каждому курсу" },
      { label: "Ведущий эксперт", text: "Практикующий невролог" },
    ],
    topics: NEUROLOGY,
  },
  {
    direction: "general-practice",
    title: "Школа терапии",
    description:
      "Ведение частых состояний в первичном звене по действующим клиническим рекомендациям.",
    facts: [
      { label: "Формат", text: "Видеолекции, памятки и разборы случаев" },
      { label: "Для кого", text: "Терапевты и врачи общей практики" },
      { label: "Документ", text: "Сертификат, часть курсов — с баллами НМО" },
    ],
    topics: THERAPY,
  },
];

/** The lessons of a course, in order; a course of N lessons takes the first N. */
const LESSON_TITLES = [
  "Эпидемиология и патогенез",
  "Диагностика",
  "Дифференциальный диагноз",
  "Лечение",
  "Клинические случаи",
  "Наблюдение и профилактика",
] as const;

/** Course 6 (index 5) is one lesson of one download; the rest vary 1–6 lessons. */
export function goldenVolumeLessonCount(course: number): number {
  return course === 5 ? 1 : 1 + ((course * 5 + 1) % 6);
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
};

function courseTitle(topics: readonly string[], course: number): string {
  const topic = topics[course % topics.length]!;
  return `${topic}${FORMATS[Math.floor(course / topics.length)]!}`;
}

/** Which volume schools carry the golden doctor's facts: every one over six courses. */
export const GOLDEN_VOLUME_FACT_COURSES = Object.freeze({
  /** Lessons 1–2 done: «Продолжить — урок 3». */
  midway: 2,
  /** Lesson 1's download opened: «Продолжить — урок 1». */
  begun: 3,
  /** Every step done: «Завершено». */
  done: 4,
});

export interface GoldenLearningVolume {
  learningSchools: (typeof learningSchools.$inferInsert)[];
  learningCourses: (typeof learningCourses.$inferInsert)[];
  learningModules: (typeof learningModules.$inferInsert)[];
  learningLessons: (typeof learningLessons.$inferInsert)[];
  learningSteps: (typeof learningSteps.$inferInsert)[];
  /** #4172 — the exit tests of the long paths (`learning-path-volume.ts`). */
  learningTests: (typeof learningTests.$inferInsert)[];
  learningQuestions: (typeof learningQuestions.$inferInsert)[];
  learningOptions: (typeof learningOptions.$inferInsert)[];
  learningOwnRuleLayers: GoldenLearningOwnLayer[];
  learningFacts: (typeof learningFacts.$inferInsert)[];
}

/** Builds the volume schools and the golden doctor's facts; `created` is the dataset's creation instant. */
export function buildGoldenLearningVolume(created: Date): GoldenLearningVolume {
  const projectId = golden.projects.publishedSchool.id;
  const stamps = { version: 1, createdAt: created, updatedAt: created };
  const memoBytes = goldenCourseMemoPdf().byteLength;
  const out: GoldenLearningVolume = {
    learningSchools: [],
    learningCourses: [],
    learningModules: [],
    learningLessons: [],
    learningSteps: [],
    learningTests: [],
    learningQuestions: [],
    learningOptions: [],
    learningOwnRuleLayers: [],
    learningFacts: [],
  };
  const doctors = golden.workerPool.verifiedCardiologist;
  const factAt = (day: number) =>
    new Date(created.getTime() + day * 86_400_000);

  golden.learning.volumeSchools.forEach((school, v) => {
    const spec = VOLUME_SCHOOLS[v]!;
    out.learningSchools.push({
      id: school.id,
      directionId: goldenDirectionId(spec.direction),
      leadExpertId: golden.experts.published.id,
      projectId,
      slug: school.slug,
      title: spec.title,
      state: "published",
      description: spec.description,
      facts: spec.facts,
      ...stamps,
    });
    for (let c = 0; c < school.courseCount; c++) {
      const ordinal = goldenLearningVolumeOrdinal(v, c);
      const courseId = goldenUuid(GOLDEN_GROUP.learningCourses, ordinal);
      const moduleId = goldenUuid(GOLDEN_GROUP.learningModules, ordinal);
      const lessons = goldenVolumeLessonCount(c);
      const quick = c === 5;
      const title = courseTitle(spec.topics, c);
      const nmo = c % 4 === 2;
      out.learningCourses.push({
        id: courseId,
        schoolId: school.id,
        projectId,
        slug: goldenLearningVolumeCourseSlug(school.slug, c),
        title,
        state: "published",
        description: `${lessons} ${plural(lessons, "урок", "урока", "уроков")} с памяткой и видеолекцией: диагностика, тактика ведения и разбор клинических ситуаций по действующим рекомендациям.`,
        academicHours: lessons * 2 + (c % 2),
        documentKind: nmo ? "certificate-nmo" : "certificate",
        documentPrerequisites: nmo
          ? "Действующее свидетельство об аккредитации специалиста"
          : "",
        partnerOrganisationId:
          c % 7 === 3 ? goldenPartnerId((v * 7 + c) % 11) : null,
        position: c + 1,
        ...stamps,
      });
      out.learningModules.push({
        id: moduleId,
        courseId,
        position: 1,
        title: title,
        ...stamps,
      });
      for (let l = 0; l < lessons; l++) {
        const lessonId = goldenUuid(
          GOLDEN_GROUP.learningLessons,
          goldenLearningVolumeOrdinal(v, c, l),
        );
        const lessonTitle =
          lessons === 1 ? "Ключевые положения" : LESSON_TITLES[l]!;
        out.learningLessons.push({
          id: lessonId,
          moduleId,
          projectId,
          position: l + 1,
          title: lessonTitle,
          description: "",
          teaser: "",
          state: "published",
          ...stamps,
        });
        const stepId = (s: number) =>
          goldenUuid(
            GOLDEN_GROUP.learningSteps,
            goldenLearningVolumeOrdinal(v, c, l, s),
          );
        out.learningSteps.push({
          id: stepId(0),
          lessonId,
          position: 1,
          type: "download",
          title: `Памятка: ${lessonTitle.toLowerCase()}`,
          durationMin: 2,
          payload: { fileName: "memo.pdf" },
          mediaRef: GOLDEN_COURSE_MEMO_KEY,
          mediaContentType: GOLDEN_COURSE_MEMO_CONTENT_TYPE,
          mediaSizeBytes: memoBytes,
          ...stamps,
        });
        if (!quick) {
          out.learningSteps.push({
            id: stepId(1),
            lessonId,
            position: 2,
            type: "video",
            title: `Видеолекция: ${lessonTitle.toLowerCase()}`,
            durationMin: 1,
            payload: { durationSec: 60 },
            provider: "youtube",
            embedRef: "dQw4w9WgXcQ",
            ...stamps,
          });
        }
      }
      out.learningOwnRuleLayers.push({
        id: goldenUuid(GOLDEN_GROUP.learningRuleLayers, ordinal),
        scopeKind: "course",
        scopeId: courseId,
        values: structuredClone(GOLDEN_VOLUME_COURSE_RULES) as Record<
          string,
          unknown
        >,
        createdAt: created,
        updatedAt: created,
      });
    }

    if (school.courseCount <= 6) return;
    // The golden doctor's facts: what the fact endpoint records for each step.
    const F = GOLDEN_VOLUME_FACT_COURSES;
    const stepsOf = (c: number, upTo: number) => {
      const ids: { id: string; type: "download" | "video" }[] = [];
      for (let l = 0; l < Math.min(upTo, goldenVolumeLessonCount(c)); l++) {
        ids.push({
          id: goldenUuid(
            GOLDEN_GROUP.learningSteps,
            goldenLearningVolumeOrdinal(v, c, l, 0),
          ),
          type: "download",
        });
        if (c !== 5)
          ids.push({
            id: goldenUuid(
              GOLDEN_GROUP.learningSteps,
              goldenLearningVolumeOrdinal(v, c, l, 1),
            ),
            type: "video",
          });
      }
      return ids;
    };
    const planned = [
      ...stepsOf(F.midway, 2),
      ...stepsOf(F.begun, 1).slice(0, 1),
      ...stepsOf(F.done, 6),
    ];
    doctors.forEach((doctor, d) => {
      planned.forEach((step, i) => {
        const tail = Number.parseInt(step.id.slice(-12), 16);
        out.learningFacts.push({
          id: goldenUuid(GOLDEN_GROUP.learningFacts, d * 1_000_000_000 + tail),
          eventId: `golden-4017-${step.id}`,
          personId: doctor.id,
          kind: step.type === "download" ? "opened" : "position",
          stepId: step.id,
          data:
            step.type === "download"
              ? {}
              : { reportedSec: 60, positionSec: 60 },
          source: "web",
          occurredAt: factAt(30 + v + i / 100),
        });
      });
    });
  });

  // #4172 — the long paths (12 and 30 modules), after the school volumes so
  // every row above keeps its position; their courses take the same own layer.
  const path = buildGoldenLearningPathVolume(created);
  out.learningSchools.push(...path.learningSchools);
  out.learningCourses.push(...path.learningCourses);
  out.learningModules.push(...path.learningModules);
  out.learningLessons.push(...path.learningLessons);
  out.learningSteps.push(...path.learningSteps);
  out.learningTests.push(...path.learningTests);
  out.learningQuestions.push(...path.learningQuestions);
  out.learningOptions.push(...path.learningOptions);
  path.ownLayerCourseIds.forEach((courseId, c) => {
    out.learningOwnRuleLayers.push({
      id: goldenUuid(GOLDEN_GROUP.learningRuleLayers, 5001 + c),
      scopeKind: "course",
      scopeId: courseId,
      values: structuredClone(GOLDEN_VOLUME_COURSE_RULES) as Record<
        string,
        unknown
      >,
      createdAt: created,
      updatedAt: created,
    });
  });
  return out;
}

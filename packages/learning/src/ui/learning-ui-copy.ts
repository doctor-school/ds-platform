import type { LearningElementType, LearningLockReason, LearningPathStep } from "@ds/schemas";

// 024 EARS-14…18, EARS-26 — the RU copy of the doctor's course path and step
// screens. Every count, duration, date and threshold is built from the read;
// no text names money, who pays or «проект».

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «12 минут», «1 академический час» (45 minutes each). */
export function durationText(min: number): string {
  if (min > 0 && min % 45 === 0) {
    const h = min / 45;
    return `${h} ${plural(h, "академический час", "академических часа", "академических часов")}`;
  }
  return `${min} ${plural(min, "минута", "минуты", "минут")}`;
}

/** «в трёх модулях»: the prepositional count, in words up to ten. */
const PREPOSITIONAL = ["", "одном", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти", "десяти"];
function modulesIn(n: number): string {
  const word = PREPOSITIONAL[n] ?? String(n);
  return `${word} ${n % 10 === 1 && n % 100 !== 11 ? "модуле" : "модулях"}`;
}

export const stepCountText = (n: number): string =>
  `${n} ${plural(n, "шаг", "шага", "шагов")}`;
export const lessonCountText = (n: number): string =>
  `${n} ${plural(n, "урок", "урока", "уроков")}`;
/** 023 EARS-5, EARS-11 — «36 академических часов», from the course row. */
export const academicHoursText = (n: number): string =>
  `${n} ${plural(n, "академический час", "академических часа", "академических часов")}`;
export const courseCountText = (n: number): string =>
  `${n} ${plural(n, "курс", "курса", "курсов")}`;

const DATE = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Moscow",
});
const DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export const STEP_TYPE_LABEL: Record<LearningElementType, string> = {
  video: "Серия",
  download: "Материал для скачивания",
  test: "Тест",
};

/** «1,2 МБ» / «350 КБ» — a file size as the canvas metas write it. */
export function fileSizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${mb.toFixed(1).replace(".", ",")} МБ`
    : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/** «10 вопросов · порог 80 %» — a test's meta as the canvas writes it. */
export const testMetaParts = (questions: number, threshold: number): string[] => [
  `${questions} ${plural(questions, "вопрос", "вопроса", "вопросов")}`,
  `порог ${threshold} %`,
];

/**
 * 024 EARS-14 — a step's meta after its type, per the canvas step metas
 * (`doctor-course.dc.html`, `doctor-lesson.dc.html`): a video «видео · 12
 * минут», a test «10 вопросов · порог 80 %», a download «PDF · 1,2 МБ». The
 * duration stands in only where the read carries no such fact.
 */
export function stepMetaParts(step: Pick<LearningPathStep, "type" | "durationMin" | "test" | "file">): string[] {
  switch (step.type) {
    case "video":
      return ["видео", durationText(step.durationMin)];
    case "test":
      return step.test
        ? testMetaParts(step.test.questionCount, step.test.threshold)
        : [durationText(step.durationMin)];
    case "download":
      return step.file
        ? [step.file.format, fileSizeText(step.file.sizeBytes)]
        : [durationText(step.durationMin)];
  }
}

/** EARS-11 / EARS-14 — a locked node's reason in the doctor's words. */
export function lockReasonText(reason: LearningLockReason): string {
  switch (reason.kind) {
    case "previous":
      return "Шаг откроется, когда будут пройдены предыдущие.";
    case "date":
      return `Шаг откроется ${DATE.format(new Date(reason.at))}.`;
    case "expression":
      return "Шаг откроется, когда будут выполнены условия курса.";
    case "registration":
      return "Чтобы пройти урок, нужна регистрация.";
  }
}

export const LEARNING_UI_COPY = {
  breadcrumbPath: "Путь курса",
  breadcrumbLabel: "Вы здесь",
  authorHeading: "Автор курса",
  summaryLabel: "Выбранный шаг пути",
  summaryActions: {
    start: "Начать",
    continue: "Продолжить",
    repeat: "Повторить",
    guest: "Открыть",
  },
  sheetNote: "Шаг пути курса",
  pathHeading: "Путь курса",
  outlineHeading: "Модули и уроки",
  outlineLabel: "Навигация по пути курса",
  here: "Вы здесь",
  /** Canvas: the line under the first locked step on the path. */
  lockNote: "Откроется после предыдущего шага",
  sequential: "Уроки открываются по порядку.",
  continueTo: (n: number) => `Продолжить — урок ${n}`,
  continueLabel: "Продолжить",
  startCourse: "Начать курс",
  /** Canvas `notStartedText`: «18 уроков в трёх модулях»; one module — «4 урока и клуб». */
  notStarted: (lessons: number, modules: number, club: boolean) =>
    modules > 1
      ? `${lessonCountText(lessons)} в ${modulesIn(modules)}`
      : `${lessonCountText(lessons)}${club ? " и клуб" : ""}`,
  start: "Начать урок",
  lessonLabel: (n: number) => `Урок ${n}`,
  /** Canvas `lessonKicker`: «Урок 8 · модуль 3 · шаг 2 из 3»; one module — no module. */
  stepPosition: (lesson: number, module: number | undefined, step: number, steps: number) =>
    `Урок ${lesson}${module ? ` · модуль ${module}` : ""} · шаг ${step} из ${steps}`,
  moduleTitle: (position: number, title: string) =>
    `Модуль ${position}. ${title}`,
  /** Canvas `sec.meta`: «6 уроков и клуб · …» — the club named when the module has one. */
  moduleMeta: (lessons: number, club: boolean, min: number) =>
    `${lessonCountText(lessons)}${club ? " и клуб" : ""} · ${durationText(min)}`,
  /** Canvas v16 eyebrow; one module (023 EARS-12) — no module count. */
  courseEyebrow: (modules: number, lessons: number, hours: number) =>
    [
      "Курс",
      modules > 1 ? `${modules} ${plural(modules, "модуль", "модуля", "модулей")}` : null,
      lessonCountText(lessons),
      hours > 0 ? academicHoursText(hours) : null,
    ]
      .filter(Boolean)
      .join(" · "),
  progress: (done: number, total: number, modulePosition?: number) =>
    `Пройдено ${done} ${plural(done, "урок", "урока", "уроков")} из ${total}` +
    (modulePosition ? ` · модуль ${modulePosition}` : ""),
  moduleProgress: (done: number, total: number) => `${done} из ${total}`,
  statusWord: {
    done: "Пройден",
    current: "Вы здесь",
    open: "Открыт",
    locked: "Закрыт",
    "test-out-reachable": "Открыт",
  },
  club: { kicker: "Клуб модуля", title: "Живой эфир", outline: "Клуб модуля · живой эфир" },
  document: {
    kicker: "Документ",
    title: "Документ по итогам",
  },
  loadingPath: "Путь курса загружается",
  emptyPath: {
    title: "Путь готовится.",
    description: "Уроки появятся здесь, когда курс будет опубликован.",
  },
  errorPath: {
    title: "Не удалось загрузить путь курса.",
    description: "Обновите страницу или попробуйте позже.",
  },
  retry: "Повторить",
  // Step screen.
  lessonEyebrow: (n: number, steps: number, min: number) =>
    `Урок ${n} · ${stepCountText(steps)} · ${durationText(min)}`,
  stepsLabel: "Шаги урока",
  /** «Шаг 2 из 3 · Тест · 10 вопросов · порог 80 %» (`doctor-lesson.dc.html` `sv.kicker`). */
  stepKicker: (no: number, of: number, step: Pick<LearningPathStep, "type" | "durationMin" | "test" | "file">) =>
    [`Шаг ${no} из ${of}`, STEP_TYPE_LABEL[step.type], ...stepMetaParts(step)].join(" · "),
  stepLoading: "Шаг загружается",
  errorStep: {
    title: "Не удалось загрузить шаг.",
    description: "Обновите страницу или попробуйте позже. Пройденное сохранено.",
  },
  gate: "Чтобы пройти урок, нужна регистрация. Вернём вас сюда.",
  gateAction: "Зарегистрироваться",
  next: "Дальше",
  back: "Назад",
  toPath: "К пути курса",
  // Video.
  watch: "Смотреть видео",
  watched: (pct: number) => `Просмотрено ${pct} %`,
  videoKind: "Серия",
  videoUnavailable: {
    title: "Видео временно недоступно",
    body: "Пройденное сохранено. Попробуйте ещё раз через минуту.",
    retry: "Попробовать ещё раз",
  },
  // Download.
  download: "Скачать",
  opened: "Материал открыт",
  /** «PDF · 1,2 МБ» under the file name; the size alone when the read names no format. */
  fileMeta: (format: string | null, bytes: number) =>
    format ? `${format} · ${fileSizeText(bytes)}` : fileSizeText(bytes),
  // Test.
  testIntro: (questions: number, threshold: number) => testMetaParts(questions, threshold).join(" · "),
  startTest: "Начать тест",
  question: (i: number, of: number) => `Вопрос ${i} из ${of}`,
  optionsLabel: "Варианты ответа",
  answer: "Ответить",
  passed: (score: number, threshold: number) =>
    `Тест сдан: ${score} % при пороге ${threshold} %`,
  failed: (score: number, threshold: number) =>
    `Тест не сдан: ${score} % при пороге ${threshold} %. Пройденные шаги сохранены.`,
  lessonDone: "Урок пройден",
  attemptsLeft: (n: number | null) =>
    n === null ? "" : `Осталось попыток: ${n}.`,
  nextAttemptAt: (at: string) =>
    `Следующая попытка — ${DATE_TIME.format(new Date(at))}.`,
  retryTest: "Повторить тест",
  unavailableTest: "Новая попытка сейчас недоступна.",
  actionFailed: "Не получилось. Попробуйте ещё раз.",
} as const;

/** 023 EARS-5, EARS-10 — what a course leads to, by its document kind. */
export const DOCUMENT_LABEL = {
  certificate: "Сертификат",
  "certificate-nmo": "Сертификат и НМО",
} as const;

/**
 * 023 EARS-4…8, EARS-11, EARS-22, EARS-23 — the RU copy of the school screen and
 * the course header. Every count and duration is a parameter from the read; no
 * text names money, who pays, «проект», «сериал» or a rules preset.
 */
export const SCHOOL_UI_COPY = {
  eyebrow: "Школа",
  loading: "Школа загружается",
  /** Canvas `heroBadge`: «3 курса · 18 уроков». */
  counts: (courses: number, lessons: number) =>
    `${courseCountText(courses)} · ${lessonCountText(lessons)}`,
  expert: "Ведущий эксперт",
  aboutHeading: "О школе",
  coursesHeading: "Курсы школы",
  courseKicker: "Курс",
  lessonsWord: (n: number) => plural(n, "урок", "урока", "уроков"),
  cta: {
    /** Canvas `doctor-school.dc.html`: a done card opens the course path. */
    done: "Открыть путь курса →",
    /** The doctor's next lesson (023-design §4); never a percent. */
    started: (lesson: number | null) =>
      lesson === null ? "Продолжить →" : `Продолжить — урок ${lesson} →`,
    open: "Открыть путь курса →",
  },
  /** 023 EARS-5 — more than six courses (canvas «много курсов»). */
  list: {
    mine: "Вы учитесь",
    all: (n: number) => `Все курсы школы · ${n}`,
    rest: (n: number) => `Остальные курсы школы · ${n}`,
    search: "Найти курс",
    searchPlaceholder: "Название или тема",
    noMatch: (q: string) =>
      `По запросу «${q}» курсов в этой школе нет. Попробуйте другое слово.`,
    more: (next: number, left: number) => `Показать ещё ${next} · осталось ${left}`,
  },
  gate: {
    title: "Начать урок — нужна регистрация. Вернём вас сюда.",
    text: "Описание школы, курсы и их путь открыты. Достаточно почты с подтверждением — диплом на входе не нужен.",
    action: "Зарегистрироваться",
  },
} as const;

export const COURSE_HEADER_COPY = {
  author: "Ведущий эксперт",
  document: "Документ по итогам",
  prerequisites: "Что нужно для документа",
  rules: "Как проходить курс",
} as const;

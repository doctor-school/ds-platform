import type { LearningElementType, LearningLockReason } from "@ds/schemas";

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

export const stepCountText = (n: number): string =>
  `${n} ${plural(n, "шаг", "шага", "шагов")}`;
export const lessonCountText = (n: number): string =>
  `${n} ${plural(n, "урок", "урока", "уроков")}`;

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
  sequential: "Уроки открываются по порядку.",
  continueTo: (n: number) => `Продолжить — урок ${n}`,
  continueLabel: "Продолжить",
  start: "Начать урок",
  lessonLabel: (n: number) => `Урок ${n}`,
  moduleTitle: (position: number, title: string) =>
    `Модуль ${position}. ${title}`,
  moduleMeta: (lessons: number, min: number) =>
    `${lessonCountText(lessons)} · ${durationText(min)}`,
  courseEyebrow: (modules: number, lessons: number) =>
    `Курс · ${modules} ${plural(modules, "модуль", "модуля", "модулей")} · ${lessonCountText(lessons)}`,
  progress: (done: number, total: number) =>
    `Пройдено ${done} ${plural(done, "урок", "урока", "уроков")} из ${total}`,
  moduleProgress: (done: number, total: number) => `${done} из ${total}`,
  statusWord: {
    done: "Пройден",
    current: "Вы здесь",
    open: "Открыт",
    locked: "Закрыт",
    "test-out-reachable": "Открыт",
  },
  club: { kicker: "Клуб модуля", title: "Живой эфир" },
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
  stepKicker: (no: number, type: LearningElementType, min: number) =>
    `Шаг ${no} · ${STEP_TYPE_LABEL[type]} · ${durationText(min)}`,
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
  fileMeta: (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb >= 1
      ? `${mb.toFixed(1).replace(".", ",")} МБ`
      : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  },
  // Test.
  testIntro: (questions: number, threshold: number) =>
    `${questions} ${plural(questions, "вопрос", "вопроса", "вопросов")} · порог ${threshold} %`,
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

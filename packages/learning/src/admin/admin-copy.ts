import type {
  LearningConditionType,
  LearningRuleNode,
  LearningSettingKey,
  LearningState,
} from "@ds/schemas";

// 024 EARS-28, EARS-29 — the staff screens' RU copy. The setting and condition
// vocabularies are keyed by the `@ds/schemas` key types, so a key added to the
// catalog without words here fails the typecheck instead of rendering a slug.

export const SETTING_LABEL: Record<LearningSettingKey, string> = {
  "completion.step": "Когда шаг пройден",
  "completion.lesson": "Когда урок пройден",
  "completion.module": "Когда модуль пройден",
  "completion.course": "Когда курс пройден",
  "viewed.video.percent": "Видео просмотрено от",
  "viewed.podcast.percent": "Подкаст прослушан от",
  unlock: "Открытие",
  order: "Порядок шагов",
  lockedVisibility: "Закрытые шаги",
  "test.threshold": "Порог теста",
  "test.attempts": "Попыток теста",
  "test.pauseMin": "Пауза между попытками",
  "test.questions": "Вопросов в попытке",
  "test.exitRequired": "Итоговый тест обязателен",
  "test.entryRequired": "Входной тест обязателен",
  "test.entryCounts": "Входной тест засчитывается",
  "testOut.allowed": "Досрочная сдача",
  "testOut.pauseMin": "Пауза перед новой досрочной сдачей",
  "repeat.allowed": "Повторное прохождение",
  "progress.maxPlaybackRate": "Наибольшая засчитываемая скорость",
  "progress.slackSec": "Запас позиции видео",
  "course.deliveryMode": "Формат курса",
  "course.moduleSize": "Уроков в модуле",
  "course.closingClub": "Закрывающий клуб",
  "course.clubInCompletion": "Клуб входит в прохождение",
};

export const CONDITION_LABEL: Record<LearningConditionType, string> = {
  viewed: "шаг просмотрен",
  "watched-at-least": "видео просмотрено",
  opened: "материал открыт",
  "listened-at-least": "подкаст прослушан",
  "test-passed": "тест сдан",
  "club-attended": "клуб посещён",
  "manual-mark": "отметка куратора",
  "all-steps-done": "все шаги пройдены",
  "lessons-done": "все уроки пройдены",
};

const TEST_KIND: Record<string, string> = {
  exit: "итоговый тест сдан",
  entry: "входной тест сдан",
};

const yesNo = (v: unknown) => (v === true ? "да" : "нет");
const minutes = (v: unknown) => `${String(v)} мин`;
const percent = (v: unknown) => `${String(v)} %`;

const ENUM_WORDS: Record<string, Record<string, string>> = {
  order: { strict: "строго по порядку", free: "в любом порядке" },
  lockedVisibility: { hidden: "скрыты", locked: "видны закрытыми" },
  "course.deliveryMode": {
    online: "онлайн",
    offline: "очно",
    open: "открытый",
  },
};

const UNLOCK_WORDS: Record<string, string> = {
  immediate: "сразу",
  "after-previous": "после предыдущего",
  "from-date": "с даты",
  expression: "по условию",
};

/** A completion or unlock rule tree in words. */
export function ruleInWords(node: LearningRuleNode): string {
  if ("all" in node)
    return `все условия — ${node.all.map(ruleInWords).join("; ")}`;
  if ("any" in node)
    return `любое из — ${node.any.map(ruleInWords).join("; ")}`;
  if ("nOf" in node)
    return `${node.nOf.n} из ${node.nOf.of.length} — ${node.nOf.of.map(ruleInWords).join("; ")}`;
  if (node.condition === "test-passed" && node.test && TEST_KIND[node.test])
    return TEST_KIND[node.test]!;
  const label =
    CONDITION_LABEL[node.condition as LearningConditionType] ?? node.condition;
  return node.percent ? `${label} от ${node.percent} %` : label;
}

/** One setting's value in words. */
export function settingValueInWords(
  key: LearningSettingKey,
  value: unknown,
): string {
  if (value === undefined || value === null) return "—";
  if (key.startsWith("completion."))
    return ruleInWords(value as LearningRuleNode);
  if (key === "unlock") {
    const u = value as {
      kind: string;
      instant?: string;
      rule?: LearningRuleNode;
    };
    const head = UNLOCK_WORDS[u.kind] ?? u.kind;
    if (u.kind === "from-date" && u.instant)
      return `${head} ${u.instant.slice(0, 10)}`;
    if (u.kind === "expression" && u.rule)
      return `${head}: ${ruleInWords(u.rule)}`;
    return head;
  }
  if (ENUM_WORDS[key]) return ENUM_WORDS[key]![String(value)] ?? String(value);
  if (typeof value === "boolean") return yesNo(value);
  if (value === "unlimited") return "без ограничений";
  if (value === "all") return "все";
  if (key.endsWith(".percent") || key === "test.threshold")
    return percent(value);
  if (key.endsWith("pauseMin")) return minutes(value);
  if (key === "progress.slackSec") return `${String(value)} с`;
  if (key === "progress.maxPlaybackRate") return `×${String(value)}`;
  return String(value);
}

export const LESSON_STATE_LABEL: Record<LearningState, string> = {
  draft: "Черновик",
  published: "Опубликован",
};

/** The request field a refusal names → the field's label on these screens. */
export const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  description: "Описание",
  teaser: "Анонс",
  durationMin: "Длительность шага",
  type: "Тип шага",
  payload: "Содержимое шага",
  provider: "Площадка",
  embedRef: "Ссылка или идентификатор видео",
  file: "Файл",
  presetId: "Пресет",
  moduleId: "Модуль",
  courseId: "Курс",
  stepIds: "Порядок шагов",
};

export const ADMIN_COPY = {
  back: "К курсу",
  lessonDuration: (min: number) => `Длительность урока: ${min} мин`,
  stepsHeading: "Шаги урока",
  noSteps: "В уроке пока нет шагов.",
  stepLine: (no: number, type: string, title: string, min: number) =>
    `Шаг ${no} · ${type} · ${title} · ${min} мин`,
  up: "Выше",
  down: "Ниже",
  remove: "Удалить",
  upLabel: (no: number) => `Поднять шаг ${no}`,
  downLabel: (no: number) => `Опустить шаг ${no}`,
  removeLabel: (no: number) => `Удалить шаг ${no}`,
  provider: "Площадка",
  embedRef: "Ссылка или идентификатор видео",
  saveSource: "Сохранить источник",
  sourceSet: (provider: string, ref: string) =>
    `Источник: ${provider} · ${ref}`,
  noSource: "Источник видео не задан.",
  file: "Файл",
  upload: "Загрузить файл",
  noFile: "Файл не загружен.",
  fileSet: (type: string, bytes: number) =>
    `Файл загружен: ${type}, ${Math.max(1, Math.round(bytes / 1024))} КБ`,
  testLine: (questions: number, threshold: number | null) =>
    threshold === null
      ? `Вопросов: ${questions}`
      : `Вопросов: ${questions} · порог сдачи ${threshold} % (из правил курса)`,
  newStep: "Новый шаг",
  newStepHint:
    "Видео получает площадку и ссылку, материал — файл, уже в списке шагов.",
  stepType: "Тип шага",
  stepTitle: "Название шага",
  stepDuration: "Длительность шага, мин",
  videoLength: "Длина видео, секунд",
  fileName: "Имя файла у врача",
  question: (q: number) => `Вопрос ${q}`,
  option: (q: number, o: number) => `Вопрос ${q}, вариант ${o}`,
  optionCorrect: (q: number, o: number) => `Вопрос ${q}, вариант ${o} — верный`,
  correctLegend: (q: number) => `Верный ответ на вопрос ${q}`,
  addOption: "Добавить вариант",
  addQuestion: "Добавить вопрос",
  removeQuestion: (q: number) => `Убрать вопрос ${q}`,
  addStep: "Добавить шаг",
  publish: "Опубликовать урок",
  unpublish: "Снять с публикации",
  publishRefused: "Урок пока нельзя опубликовать:",
  writeRefused: "Изменение не сохранено:",
  stale: "Урок изменили в другом окне — показана текущая версия.",
  failed: "Не удалось сохранить. Попробуйте ещё раз.",
  loadFailed: "Не удалось загрузить данные.",
  retry: "Повторить",
  loading: "Загрузка…",
  // Course screen
  modulesHeading: "Модули и уроки",
  moduleHeading: (no: number, title: string) => `Модуль ${no}. ${title}`,
  lessonLink: (no: number, title: string) => `Урок ${no}. ${title}`,
  lessonMeta: (state: string, min: number) => `${state} · ${min} мин`,
  noLessons: "В модуле пока нет уроков.",
  noModules: "В курсе пока нет модулей.",
  moduleTitle: "Название модуля",
  addModule: "Добавить модуль",
  lessonTitle: "Название урока",
  lessonDescription: "Описание",
  lessonTeaser: "Анонс",
  addLesson: "Добавить урок",
  presetHeading: "Пресет правил курса",
  presetHint:
    "Пресет задаёт правила курса одним выбором. Настройки, заданные в модулях, уроках и шагах, остаются.",
  presetApplied: (name: string) => `Применён: ${name}`,
  applyPreset: "Применить пресет",
  presetDone: (name: string) =>
    `Пресет «${name}» применён к курсу. Настройки, заданные в модулях, уроках и шагах, сохранены.`,
  presetEmpty: "Пресеты не найдены.",
} as const;

import type {
  LearningConditionType,
  LearningRuleNode,
  LearningScopeKind,
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
  slug: "Адрес",
  facts: "Факты «О школе»",
  soonNote: "Пометка «скоро»",
  communityUrl: "Ссылка на сообщество",
  mentoringOffer: "Наставничество",
  internshipOffer: "Стажировка",
  academicHours: "Академических часов",
  documentKind: "Документ",
  documentPrerequisites: "Что нужно для документа",
  partnerOrganisationId: "Партнёр",
  courseIds: "Порядок курсов",
  moduleIds: "Порядок модулей",
  directionId: "Направление",
  leadExpertId: "Ведущий эксперт",
  projectId: "Проект",
  schoolId: "Школа",
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
  publishedReadOnly:
    "Урок опубликован, его шаги не меняются. Чтобы изменить шаги, снимите урок с публикации.",
  providersWithoutClock: (names: string) =>
    `Площадка ${names} для шагов недоступна: её плеер не сообщает, сколько видео просмотрено.`,
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
  presetDone: (name: string, scope: "school" | "course" = "course") =>
    scope === "school"
      ? `Пресет «${name}» применён к школе. Настройки, заданные в курсах, модулях, уроках и шагах, сохранены.`
      : `Пресет «${name}» применён к курсу. Настройки, заданные в модулях, уроках и шагах, сохранены.`,
  presetEmpty: "Пресеты не найдены.",
} as const;

/** EARS-5 — a scope level in words («Унаследовано от: курс»). */
export const LEVEL_LABEL: Record<LearningScopeKind, string> = {
  platform: "платформа",
  school: "школа",
  course: "курс",
  module: "модуль",
  lesson: "урок",
  step: "шаг",
};

/** EARS-6…8 — the editor's sections, each with its settings in reading order. */
export const SETTING_SECTIONS: readonly {
  title: string;
  keys: readonly LearningSettingKey[];
}[] = [
  {
    title: "Прохождение",
    keys: [
      "completion.step",
      "completion.lesson",
      "completion.module",
      "completion.course",
      "viewed.video.percent",
      "viewed.podcast.percent",
    ],
  },
  {
    title: "Открытие и порядок",
    keys: ["unlock", "order", "lockedVisibility"],
  },
  {
    title: "Тесты",
    keys: [
      "test.threshold",
      "test.attempts",
      "test.pauseMin",
      "test.questions",
      "test.exitRequired",
      "test.entryRequired",
      "test.entryCounts",
      "testOut.allowed",
      "testOut.pauseMin",
      "repeat.allowed",
    ],
  },
  {
    title: "Засчитывание просмотра",
    keys: ["progress.maxPlaybackRate", "progress.slackSec"],
  },
  {
    title: "Курс",
    keys: [
      "course.deliveryMode",
      "course.moduleSize",
      "course.closingClub",
      "course.clubInCompletion",
    ],
  },
];

/** The words of one enum setting's options, for its select. */
export const SETTING_OPTIONS: Partial<
  Record<LearningSettingKey, Record<string, string>>
> = {
  order: { strict: "строго по порядку", free: "в любом порядке" },
  lockedVisibility: { hidden: "скрыты", locked: "видны закрытыми" },
  "course.deliveryMode": {
    online: "онлайн",
    offline: "очно",
    open: "открытый",
  },
};

export const UNLOCK_KIND_LABEL: Record<string, string> = {
  immediate: "сразу",
  "after-previous": "после предыдущего",
  "from-date": "с даты",
  expression: "по условию",
};

const doctorsGenitive = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "врача" : "врачей";

export const RULES_COPY = {
  heading: (kind: LearningScopeKind) =>
    ({
      platform: "Правила платформы",
      school: "Правила школы",
      course: "Правила курса",
      module: "Правила модуля",
      lesson: "Правила урока",
      step: "Правила шага",
    })[kind],
  hint: "Каждая настройка действует от ближайшего уровня, где она задана: шаг → урок → модуль → курс → школа → платформа.",
  setHere: "Задано здесь",
  inherited: (level: LearningScopeKind, preset: string | null) =>
    `Унаследовано от: ${LEVEL_LABEL[level]}${preset ? ` · пресет «${preset}»` : ""}`,
  willInherit: "Станет унаследованным после сохранения",
  edit: (label: string) => `Изменить: ${label}`,
  revert: (label: string) => `Вернуть унаследованное: ${label}`,
  editShort: "Изменить",
  revertShort: "Вернуть унаследованное",
  save: "Сохранить правила",
  discard: "Отменить изменения",
  presetHeldByDraft:
    "Сохраните или отмените изменения настроек, чтобы применить пресет.",
  saved: "Правила сохранены.",
  refused: "Правила не сохранены:",
  // A refused setting in words: the validator's own text is for API clients.
  invalidRule: "правило составлено неверно — проверьте условия.",
  invalidNumber: (min: number, max: number, integer: boolean) =>
    `укажите ${integer ? "целое " : ""}число от ${min} до ${max}.`,
  invalidValue: "такое значение не подходит.",
  stale: "Правила изменили в другом окне — показана текущая версия.",
  readOnly: {
    platform:
      "Правила платформы и пресеты меняет только редактор правил обучения.",
    published:
      "Правила опубликованного курса меняет только редактор правил обучения.",
    draft:
      "Правила курса-черновика меняют сотрудники, которые редактируют курс.",
  },
  unlimited: "без ограничений",
  allQuestions: "все",
  date: "Дата открытия",
  unlockKind: "Как открывается",
  // The completion-rule builder (EARS-6).
  ruleKind: "Вид правила",
  ruleKinds: {
    condition: "одно условие",
    all: "все условия",
    any: "любое из условий",
    nOf: "N из M",
  } as Record<string, string>,
  nOfN: "Сколько условий",
  condition: (path: string) => `Условие ${path}`,
  conditionPercent: (path: string) => `Условие ${path}, процент`,
  conditionTest: (path: string) => `Условие ${path}, тест`,
  groupKind: (path: string) => `Группа ${path}, вид`,
  removeCondition: (path: string) => `Убрать условие ${path}`,
  addCondition: "Добавить условие",
  addGroup: "Добавить группу",
  testKinds: { exit: "итоговый", entry: "входной" } as Record<string, string>,
  // The change dialog (EARS-31, owner D16).
  dialogTitle: "Изменение правил опубликованного курса",
  impact: (n: number) =>
    n === 0
      ? "Статус врачей не изменится."
      : `Изменится статус у ${n} ${doctorsGenitive(n)}.`,
  impactDetail: (toDone: number, toNotDone: number) =>
    `Станут пройденными: ${toDone} · перестанут быть пройденными: ${toNotDone}.`,
  earnedLegend: "Что сделать с уже пройденным",
  keep: "Сохранить заработанные зачёты",
  keepHint: "Врачи, уже прошедшие элемент, сохраняют зачёт.",
  requireAgain: "Потребовать заново",
  requireAgainHint:
    "Зачёт решают новые правила: врачу может понадобиться пройти элемент снова.",
  apply: "Применить изменение",
  cancel: "Отмена",
  previewFailed:
    "Не удалось посчитать, кого затронет изменение. Попробуйте ещё раз.",
  // Presets on the platform scope (EARS-9, EARS-29).
  presetsHeading: "Пресеты",
  presetsHint:
    "Изменение пресета действует на следующие применения; курсы и школы, где он уже применён, не меняются.",
  editPreset: (name: string) => `Изменить пресет «${name}»`,
  savePreset: "Сохранить пресет",
  presetSaved: (name: string) => `Пресет «${name}» сохранён.`,
  removeFromPreset: (label: string) => `Убрать из пресета: ${label}`,
  addToPreset: "Добавить настройку",
  addToPresetNone: "Выберите настройку",
  stepRules: (no: number) => `Правила шага ${no}`,
} as const;

const RU_PLURAL = new Intl.PluralRules("ru-RU");
const DOCTORS: Partial<Record<Intl.LDMLPluralRule, string>> & { many: string } =
  {
    one: "врач",
    few: "врача",
    many: "врачей",
  };

/**
 * 023 EARS-26, EARS-27 — the school and course structure editor in staff
 * words. Never a price, a preset name or «бесплатно» (EARS-23 holds for the
 * doctor screens; the editor follows the same vocabulary).
 */
export const STRUCTURE_COPY = {
  // School editor
  schoolState: { draft: "Черновик", published: "Опубликована" },
  publishSchool: "Опубликовать школу",
  unpublishSchool: "Снять школу с публикации",
  schoolPublishedHint:
    "Школа видна врачам на сайте. Пока в ней нет опубликованного курса, врачи видят её как «скоро».",
  schoolOpenHint:
    "Школа видна врачам на сайте и открыта: в ней есть опубликованный курс.",
  schoolDraftHint: "Школа — черновик: врачи её не видят.",
  interestCount: (n: number) =>
    `Интерес к школе: ${n} ${DOCTORS[RU_PLURAL.select(n)] ?? DOCTORS.many}`,
  detailsHeading: "Данные школы",
  schoolTitle: "Название школы",
  schoolDescription: "Описание",
  soonNote: "Пометка «скоро»",
  soonNoteHint: "Видна врачам, пока в школе нет опубликованного курса.",
  communityUrl: "Ссылка на сообщество (https)",
  mentoringOffer: "Наставничество — текст предложения",
  internshipOffer: "Стажировка — текст предложения",
  factsLegend: "Факты «О школе» (до четырёх)",
  factLabel: (no: number) => `Факт ${no} — заголовок`,
  factText: (no: number) => `Факт ${no} — текст`,
  addFact: "Добавить факт",
  removeFact: (no: number) => `Убрать факт ${no}`,
  save: "Сохранить",
  saved: "Сохранено.",
  coursesHeading: "Курсы школы",
  noCourses: "В школе пока нет курсов.",
  courseUp: (title: string) => `Поднять курс «${title}»`,
  courseDown: (title: string) => `Опустить курс «${title}»`,
  newCourseHeading: "Новый курс",
  courseTitle: "Название курса",
  courseSlug: "Адрес курса (латиница, цифры и дефисы)",
  addCourse: "Создать курс",
  // Course editor
  toSchool: "К школе",
  courseDetailsHeading: "Данные курса",
  courseDescription: "Описание курса",
  academicHours: "Академических часов",
  documentLegend: "Документ по окончании курса",
  documentKind: {
    certificate: "Сертификат",
    "certificate-nmo": "Сертификат с баллами НМО",
  },
  documentPrerequisites: "Что нужно для документа",
  publishCourse: "Опубликовать курс",
  unpublishCourse: "Снять курс с публикации",
  courseState: { draft: "Черновик", published: "Опубликован" },
  moduleRename: (no: number) => `Новое название модуля ${no}`,
  rename: "Переименовать",
  moduleUp: (no: number) => `Поднять модуль ${no}`,
  moduleDown: (no: number) => `Опустить модуль ${no}`,
  // Refusals
  coursePublishRefused:
    "Курс нельзя опубликовать: в нём нет опубликованного урока. Опубликуйте хотя бы один урок.",
  slugTaken: "Этот адрес уже занят — выберите другой.",
  stale:
    "Данные изменили в другом окне — показана текущая версия, повторите изменение.",
  alreadyInState: "Состояние уже изменено — показана текущая версия.",
} as const;

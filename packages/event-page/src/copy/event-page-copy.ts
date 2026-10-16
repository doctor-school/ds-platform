import type { RecordingKind } from "@ds/schemas";

/**
 * The event page's copy (020 EARS-18, wave-3 gate §4.3 D7). The package renders
 * no `next-intl` catalogue and a route mount may not read one, so every fixed
 * sentence of the page lives here once. These are the Academy's `webinar` and
 * `room.accessGuidance` sentences, moved verbatim from
 * `apps/portal/messages/ru.json` in wave-3 PR 3.1 (#2072). The one word a host
 * varies — the breadcrumb — is host config (`copy.breadcrumb`), not copy.
 */
export const EVENT_PAGE_COPY = {
  cta: {
    registerError: "Не удалось записаться. Попробуйте ещё раз.",
  },
  /** The hero's lifecycle word per 004 state. */
  state: {
    published: "Скоро",
    live: "В эфире",
    ended: "Эфир завершён",
    hidden: "Скрыто",
  },
  recordingBadge: {
    available: "Запись доступна",
    preparing: "Запись готовится",
  },
  recordingKind: {
    edited: "Монтаж",
    raw: "Оригинал",
    duration: (duration: number) => `${duration} мин`,
  } satisfies Record<RecordingKind, string> & {
    duration: (duration: number) => string;
  },
  recordingSpoiler: {
    summary: "Смотреть оригинал трансляции",
    hint: "без монтажа, с паузами и вопросами между блоками",
  },
  plaque: {
    timeLabel: "Запись",
    timeValue: (date: string) => `до ${date}`,
    title: "Запись готовится",
    bodyDated: (date: string) =>
      `Монтируем запись — опубликуем на этой странице до ${date}.`,
    bodyUndated:
      "Монтируем запись — она появится на этой странице, как только будет готова.",
  },
  playerGate: {
    eyebrow: (duration: number) => `Запись эфира · ${duration} мин`,
    title: "Войдите, чтобы посмотреть запись",
    body: "Doctor.School бесплатна для врачей. Вход — почта и специальность, две минуты.",
    cta: "Войти и смотреть ↗",
    noAccount: "Нет аккаунта?",
    signUp: "Создать",
  },
  playerUnavailable: {
    title: "Запись временно недоступна",
    body: "Плеер не загрузился. Проверьте соединение и попробуйте ещё раз.",
    retry: "Попробовать ещё раз",
  },
  page: {
    about: "О чём событие",
    program: "Программа",
    programDownload: "Скачать программу (PDF)",
    sponsorEyebrow: "При поддержке",
    sponsorNote:
      "Спонсор оплачивает эфир и не влияет на программу. Содержание определяют спикеры и школа.",
  },
  /** The room access-branch guidance shown above the page on `?from=room`. */
  accessGuidance: {
    title: "Чтобы войти в эфир, сначала зарегистрируйтесь",
    body: "Комната трансляции открыта только для зарегистрированных участников. Нажмите «Участвовать» — и вы сразу вернётесь в эфир.",
  },
} as const;

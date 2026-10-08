import {
  DEFAULT_EVENT_NOUN,
  type PluralNoun,
  formatEventCount,
} from "../model/event-count";

/**
 * The events listing's default copy — the week («Неделя») and month («Месяц»)
 * panes. The package renders no `next-intl` catalogue (the doctor storefront has
 * none), so every fixed sentence lives here once; a host states only its page
 * head (`headerCopy`) and its event noun (`copy.eventNoun`) in its host config.
 *
 * These are the Academy's sentences, moved verbatim from its `webinars`
 * catalogue in wave-2 PR 2.2 (zero behaviour change). PR 2.4 converges them on
 * the canvas for both hosts (wave-2 entry gate §4.4, recorded deviation).
 */

const RECORD_NOUN: PluralNoun = {
  one: "запись",
  few: "записи",
  many: "записей",
};

export const LISTING_COPY = {
  archiveSubtitle: (count: number) =>
    `Архив · ${formatEventCount(count, RECORD_NOUN)} · доступ после входа`,
  cardTz: "МСК",
  cardDate: (date: string, weekday: string) => `${date} · ${weekday}`,
  live: "В эфире",
  tabs: { upcoming: "Расписание", past: "Архив записей" },
  recordingCta: "Смотреть запись ↗",
  recording: {
    montage: "Запись · монтаж",
    "raw-only": "Запись эфира",
    preparing: "Запись готовится",
  },
  pagination: {
    label: "Страницы мероприятий",
    previous: "Назад",
    next: "Вперёд",
    page: "Страница",
  },
  empty: {
    title: "Нет предстоящих эфиров",
    body: "Сейчас нет запланированных эфиров. Загляните позже — расписание обновляется регулярно.",
  },
  pastEmpty: {
    title: "Прошедших эфиров пока нет",
    body: "После завершения мероприятия появятся здесь вместе со статусом записи.",
  },
  registered: "Вы записаны",
  /**
   * The month view of the one page (wave-2 gate rows 53–55, the #2076 canvas
   * `events-feed-kit.js` `gridWeeks` / `dotWeeks` / `agenda` / `pickerFor`);
   * the month-grid pill and legend say «Идёт сейчас» on both hosts (§4.3 D6).
   */
  month: {
    todaySuffix: " · сегодня",
    liveLabel: "Идёт сейчас",
    agendaLive: "В эфире",
    legendLive: "Идёт сейчас",
    legendPlanned: "Запланировано",
    legendPast: "Прошло",
    agendaEmpty: (noun: PluralNoun) => `В этот день ${noun.many} нет`,
    dayEventsLabel: (count: number, noun: PluralNoun) =>
      formatEventCount(count, noun),
    pickerLabel: "Выбрать месяц",
    pickerCount: (count: number, noun: PluralNoun) =>
      formatEventCount(count, noun),
    pickerPast: "архив",
    pickerEmpty: (noun: PluralNoun) => `нет ${noun.many}`,
    moreLink: (count: number) => `+${count} ещё`,
    nextMonthLink: (month: string) => `${month} →`,
    prevMonthLink: (month: string) => `← ${month}`,
    prevMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    prevYear: "Предыдущий год",
    nextYear: "Следующий год",
    todayButton: "Сегодня",
    errorTitle: "Не удалось загрузить календарь",
    errorBody: "Сервер не ответил. Проверьте соединение и попробуйте снова.",
  },
  /** The switch between the two views of the one page (row 51). */
  view: {
    toMonth: "Календарь на месяц →",
    toFeed: "← Лента событий",
  },
} as const;

/** The host's event noun, or the package default «событие». */
export function eventNounOf(copy?: { eventNoun?: PluralNoun }): PluralNoun {
  return copy?.eventNoun ?? DEFAULT_EVENT_NOUN;
}

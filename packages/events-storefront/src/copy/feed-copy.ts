import type { EventParticipationFormat } from "@ds/schemas";

/**
 * The events feed view's copy — one module for both storefronts (wave-2 entry
 * gate §2.4, the #2076 canvas `design-source/events-feed.dc.html` +
 * `events-feed-kit.js`). A host states only its page head (`headerCopy`) and its
 * event noun (`copy.eventNoun`); every other sentence lives here.
 */
export const FEED_COPY = {
  tense: {
    label: "Время событий",
    past: "Прошедшие",
    upcoming: "Будущие",
  },
  card: {
    date: (date: string, weekday: string) => `${date} · ${weekday}`,
    format: {
      online: "Онлайн",
      offline: "Офлайн",
      hybrid: "Гибрид",
    } satisfies Record<EventParticipationFormat, string>,
    live: "В эфире",
    registered: "Вы записаны",
    signUp: "Коллег записались",
    nmo: "НМО",
    pul: (cost: number) => `${cost} Pul`,
    seatsLeft: "мест осталось",
    soldOut: "мест не осталось",
    venueTime: (time: string, zone: string) => `На площадке ${time} ${zone}`,
    recordingCta: "Смотреть запись",
    /** «Запись · 54 мин» / «Запись · 1 ч 12 мин»; a cut of unrecorded length reads «Запись». */
    recording: (durationSec: number | null) => {
      if (durationSec === null) return "Запись";
      const minutes = Math.max(1, Math.round(durationSec / 60));
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours === 0
        ? `Запись · ${minutes} мин`
        : `Запись · ${hours} ч ${String(rest).padStart(2, "0")} мин`;
    },
    noRecording: "Без записи",
  },
  live: {
    heading: "Идёт сейчас",
    inRoom: "в комнате",
    until: "до",
    enterRoom: "Войти в комнату эфира",
    openEvent: "Открыть страницу события",
    more: (count: number) => `Ещё ${count} в эфире →`,
    errorTitle: "Не удалось проверить, что сейчас в эфире",
    errorBody: "Сервер трансляций не ответил. Лента и «Мои события» работают.",
  },
  my: {
    title: "Мои события",
    all: "Все мои события →",
    errorTitle: "Не удалось загрузить «Мои события»",
    errorBody:
      "Сервис записей временно недоступен. Ваши записи сохранены, лента ниже работает.",
  },
  feed: {
    pagination: "Лента событий",
    showMore: "Показать ещё",
    showMoreOf: (batch: number, remaining: number) =>
      `Показать ещё ${batch} из ${remaining}`,
    errorTitle: "Не удалось загрузить ленту событий",
    errorBody: "Сервер не ответил. Проверьте соединение и попробуйте снова.",
    empty: (manyNoun: string) =>
      `${manyNoun.charAt(0).toUpperCase()}${manyNoun.slice(1)} нет`,
    emptyByFacet: (manyNoun: string, facet: string) =>
      `Нет ${manyNoun} по фильтру «${facet}»`,
    emptyByFacetBody: "Уберите фильтр, чтобы увидеть больше.",
    removeFacet: (facet: string) => `Убрать фильтр «${facet}»`,
    widenSpecialty: "Показать смежные специальности",
    emptyFiltered: (manyNoun: string) => `По выбранным фильтрам ${manyNoun} нет`,
    emptyFilteredBody: "Сбросьте фильтры, чтобы увидеть всю ленту.",
    resetFilters: "Сбросить фильтры",
  },
  facet: {
    specialty: "Специальность",
    format: "Формат",
    kind: "Вид",
    city: "Город",
    nmo: "Только с НМО",
    query: (q: string) => `Поиск: «${q}»`,
  },
  retry: "Повторить",
  monthView: "Календарь на месяц →",
} as const;

export type FeedCopy = typeof FEED_COPY;

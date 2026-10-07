import type { MyEventItem } from "@ds/schemas";

/**
 * The «Мои события» page copy (014 EARS-9). The package renders no `next-intl`
 * catalogue, so every fixed sentence lives here once, the same on both
 * storefronts. These are the Academy's `myEvents` sentences, moved verbatim in
 * wave-2 PR 2.3; the doctor's account page is the Academy's (owner 2026-09-06).
 * «Войти в эфир» is the same words the event page's enter-room CTA uses.
 */

const UPCOMING_FORMS = {
  one: "предстоящее событие",
  few: "предстоящих события",
  many: "предстоящих событий",
} as const;
const PAST_FORMS = {
  one: "прошедшее событие",
  few: "прошедших события",
  many: "прошедших событий",
} as const;

const PLURAL = new Intl.PluralRules("ru-RU");

function countOf(
  count: number,
  forms: { one: string; few: string; many: string },
): string {
  const form = PLURAL.select(count);
  const noun =
    form === "one" ? forms.one : form === "few" ? forms.few : forms.many;
  return `${count} ${noun}`;
}

export const MY_EVENTS_COPY = {
  title: "Мои события",
  subtitle: (count: number) =>
    count === 0 ? "Нет предстоящих событий" : countOf(count, UPCOMING_FORMS),
  recordingsSubtitle: (count: number) =>
    count === 0 ? "Пока нет прошедших событий" : countOf(count, PAST_FORMS),
  tzEyebrow: "Часовой пояс",
  tzValue: "Москва · UTC+3",
  cardDate: (date: string, weekday: string) => `${date} · ${weekday}`,
  live: "В эфире",
  tabs: { upcoming: "Предстоящие", recordings: "Записи" },
  recording: {
    montage: "Запись · монтаж",
    "raw-only": "Запись эфира",
    preparing: "Запись готовится",
  } satisfies Record<NonNullable<MyEventItem["recording"]>["state"], string>,
  recordingCta: "Смотреть запись ↗",
  roomCta: "Войти в эфир",
  pagination: {
    label: "Страницы моих событий",
    previous: "Назад",
    next: "Вперёд",
    page: "Страница",
  },
  empty: {
    title: "Пока нет предстоящих событий",
    body: "Вы ещё не записаны ни на один предстоящий эфир. Загляните в расписание и выберите эфир по своей специальности.",
  },
  recordingsEmpty: {
    title: "Пока нет прошедших событий",
    body: "Здесь появятся эфиры, на которые вы записывались, — вместе со статусом записи, как только эфир завершится.",
  },
} as const;

import type { EventsFilterLabels } from "@ds/design-system/blocks";
import type { EventParticipationFormat } from "@ds/schemas";

import { type PluralNoun, formatEventCount } from "../model/event-count";

/**
 * The facet panel's copy — one module for both storefronts (wave-2 entry gate
 * rows 58–60, the #2076 canvas `design-source/events-feed.dc.html`
 * `filterProps`). A host states only its `filterSet`; the labels of both sets
 * live here.
 */
const SHARED = {
  panel: "Фильтры",
  title: "Фильтры",
  appliedCount: (count: number) => `Применено: ${count}`,
  reset: "Сбросить",
  removeFacet: "Убрать",
  combobox: {
    emptyLabel: "Ничего не найдено",
    searchLabel: "Найти",
    countLabel: (shown: number, total: number) =>
      `Найдено ${shown} из ${total}`,
    loadMoreLabel: "Показать ещё",
    loadingMoreLabel: "Загружаем…",
    loadMoreErrorLabel: "Повторить",
  },
} satisfies Pick<
  EventsFilterLabels,
  "panel" | "title" | "appliedCount" | "reset" | "removeFacet" | "combobox"
>;

export const FILTER_COPY = {
  doctor: {
    ...SHARED,
    query: { label: "Поиск по названию", placeholder: "Например, PRP" },
    specialty: {
      label: "Специальность",
      mine: "Моя и смежные",
      all: "Все специальности",
      placeholder: "Выбрать специальность",
      addPlaceholder: "Добавить специальность",
      searchPlaceholder: "Например, кардиология",
    },
    format: "Формат",
    kind: "Вид события",
    city: {
      label: "Город",
      hint: "Только для офлайн-событий",
      placeholder: "Любой город",
      addPlaceholder: "Добавить город",
      searchPlaceholder: "Начните вводить город",
    },
  } satisfies EventsFilterLabels,
  academy: {
    ...SHARED,
    project: {
      label: "Проект",
      placeholder: "Все проекты",
      addPlaceholder: "Добавить проект",
      searchPlaceholder: "Например, школа продюсеров",
    },
    expert: {
      label: "Эксперт",
      placeholder: "Все эксперты",
      addPlaceholder: "Добавить эксперта",
      searchPlaceholder: "Фамилия или имя",
    },
    topic: {
      label: "Тема",
      placeholder: "Все темы",
      addPlaceholder: "Добавить тему",
      searchPlaceholder: "Например, метрики",
    },
  } satisfies EventsFilterLabels,
  format: {
    online: "Онлайн",
    offline: "Офлайн",
    hybrid: "Гибрид",
  } satisfies Record<EventParticipationFormat, string>,
  /** The doctor «Только с НМО» switch — rendered only when the read distinguishes НМО. */
  nmoOnly: "Только с НМО",
  /** The narrow-screen control that opens the sheet: «Фильтры» / «Фильтры (2)». */
  openSheet: (applied: number) =>
    applied > 0 ? `Фильтры (${applied})` : "Фильтры",
  sheetDescription: "Фасеты ленты событий",
  /** The sheet's close action, stating the live count: «Показать 12 событий». */
  showN: (count: number, noun: PluralNoun) =>
    `Показать ${formatEventCount(count, noun)}`,
} as const;

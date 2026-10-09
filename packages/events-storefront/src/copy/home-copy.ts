import { TARGETING_GENERAL_FALLBACK_STATEMENT_RU } from "@ds/schemas";

/**
 * The home nearest-events block's copy (017 EARS-9, the canvas
 * `design-source/doctor-home.dc.html` section «d-home · события»). The block
 * is a doctor-home composition (product divergence 017 EARS-9 — the Academy
 * home is feature 013); every sentence lives here, none in the host.
 */
export const HOME_EVENTS_COPY = {
  title: "Ближайшие события",
  all: "Все события →",
  kicker: {
    /** Before a specialty is chosen, and for «Другое» (017 LD-5). */
    general: "События",
    targeted: "По вашей специальности и смежным областям",
  },
  /** The LD-5 statement a «Другое» choice carries (017 EARS-8). */
  generalFallback: TARGETING_GENERAL_FALLBACK_STATEMENT_RU,
  empty: {
    targeted: "Пока ничего не запланировано по вашей специальности",
    general: "Пока ничего не запланировано",
    adjacentLead: "Посмотрите события смежных областей — ",
    adjacentLink: "все события →",
  },
  error: {
    title: "Не удалось загрузить события.",
    retry: "Обновить",
  },
} as const;

/**
 * 003 EARS-72 — the refusal page's words (owner copy, #3379, 2026-10-29).
 *
 * Three variants per reason; a render picks one at random, separately per
 * reason, and a variant's heading and text always go together. The labels
 * are the same on every host.
 */
export type EntryRefusalVariant = {
  readonly title: string;
  readonly text: string;
};

export const ENTRY_REFUSAL_COPY = {
  variants: {
    "rate-limited": [
      {
        title: "Пульс зашкаливает",
        text: "Слишком много попыток входа подряд. Дайте системе пару минут отдышаться — и попробуйте снова.",
      },
      {
        title: "Даже самым настойчивым нужен перерыв",
        text: "Попыток входа было многовато. Пара минут отдыха — и дверь снова откроется.",
      },
      {
        title: "Стоп, давайте без тахикардии",
        text: "Слишком много попыток за короткое время. Подождите несколько минут — потом вход заработает.",
      },
    ],
    unavailable: [
      {
        title: "Сервер на консилиуме",
        text: "Вход ненадолго недоступен: мы уже собрали консилиум и лечим. Попробуйте ещё раз чуть позже.",
      },
      {
        title: "Сервер ушёл на обход",
        text: "Скоро вернётся и всех примет. Попробуйте войти ещё раз через несколько минут.",
      },
      {
        title: "У сервера плановая процедура",
        text: "Мы уже рядом и следим за показателями. Попробуйте ещё раз чуть позже.",
      },
    ],
  },
  retry: "Попробовать ещё раз",
  /** Template with `{time}` — the remaining wait as `M:SS`. */
  retryIn: "Можно повторить через {time}",
  backToEvent: "Вернуться к эфиру",
  home: "На главную",
  /** The sign-in site's way out: one line, the two site names are links. */
  sitesLead: "Или перейдите на",
  sitesJoin: "или на",
  academySite: "сайт Академии",
  doctorSite: "витрину врача",
  pageTitle: "Вход недоступен — Doctor.School",
} as const satisfies {
  variants: Record<string, readonly EntryRefusalVariant[]>;
  [key: string]: unknown;
};

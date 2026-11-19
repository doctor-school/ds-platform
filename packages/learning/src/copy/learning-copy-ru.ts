// 024 EARS-17, EARS-26 — the RU copy the sentence builder assembles. Every
// number is a parameter from the resolved rules; no sentence is a fixed string
// and nothing here speaks of money, «бесплатно» or «проект».

export const LEARNING_COPY_RU = {
  /** «<Item> засчитывается, когда …» — by the kind of the item the rule completes. */
  sentencePrefix: {
    step: "Шаг засчитывается, когда",
    lesson: "Урок засчитывается, когда",
    module: "Модуль засчитывается, когда",
    course: "Курс засчитывается, когда",
  },
  phrase: {
    videoWatched: (percent: number) => `видео просмотрено на ${percent} %`,
    videoWatchedAtLeast: (percent: number) =>
      `видео просмотрено не менее чем на ${percent} %`,
    podcastListenedAtLeast: (percent: number) =>
      `подкаст прослушан не менее чем на ${percent} %`,
    downloadOpened: "материал открыт",
    testPassed: (threshold: number) => `тест сдан не ниже ${threshold} %`,
    clubAttended: "посещён клуб модуля",
    manualMark: "куратор отметил прохождение",
    allStepsDone: "пройдены все шаги",
    lessonsDone: "пройдены все уроки",
    modulesDone: "пройдены все модули",
    stepViewed: (title: string, clause: string) => `в шаге «${title}» ${clause}`,
    nOf: (n: number, clauses: string) => `выполнено не менее ${n} из условий: ${clauses}`,
    /** The sentence when every condition of the rule is switched off by its setting. */
    always: "он открыт",
  },
  /**
   * 023 EARS-11 — «what opens when» at the course scope: one sentence per
   * unlock rule (and test-out), from the resolved values; never a preset name.
   */
  unlockSentence: {
    immediate: "Все уроки открыты сразу",
    afterPrevious: "Следующий урок открывается, когда пройден предыдущий",
    fromDate: (date: string) => `Уроки открываются с ${date}`,
    expression: (clause: string) => `Уроки открываются, когда ${clause}`,
    testOut: "Урок можно засчитать досрочно, сдав его тест",
  },
  /** 023 EARS-13 — the certificate needs the whole course, from its completion rule. */
  certificateSentence: (clause: string | null) =>
    clause ? `Сертификат выдаётся за весь курс — когда ${clause}` : "Сертификат выдаётся за весь курс",
  and: " и ",
  or: " или ",
  /** EARS-14 — a locked node's reason in the doctor's words. */
  lockReason: {
    previous: "Шаг откроется, когда будут пройдены предыдущие.",
    date: (date: string) => `Шаг откроется ${date}.`,
    expression: "Шаг откроется, когда будут выполнены условия курса.",
    registration: "Чтобы пройти урок, нужна регистрация. Вернём вас сюда.",
  },
} as const;

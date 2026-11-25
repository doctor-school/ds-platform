/**
 * 033 — the RU copy of the «Подать заявку» page (033-requirements EARS-3…10;
 * wording from the owner's Stage A canvas `design-source/academy-apply.dc.html`
 * at `scope` = «срез 1»). One dictionary, so the page, its states and the
 * tests read the same strings.
 */
export const applicationsCopy = {
  gate: {
    text: "Заявка отправляется под той же учётной записью, что у врача — отдельной «регистрации эксперта» нет. После входа или регистрации вы вернётесь сюда, к форме заявки.",
    signIn: "Войти",
    register: "Регистрация",
  },
  repeatBanner: {
    lead: "Ваша предыдущая заявка в работе.",
    rest: "Новую можно отправить, если это другой проект.",
  },
  form: {
    sendingAs: (displayName: string, email: string) =>
      `Отправите как ${displayName} · ${email}`,
    required: "обязательно",
    topic: "Тема",
    specialty: "Специальность",
    specialtyPlaceholder: "Выберите специальность",
    specialtyOther: "Другое",
    format: "Формат",
    formats: {
      course_series: "курс-сериал",
      single_lesson: "отдельный урок",
      podcast: "подкаст",
      talk: "выступление",
    },
    about: "О себе",
    submit: "Отправить заявку",
  },
  errors: {
    topicRequired: "Укажите тему заявки",
    topicTooLong: "Не длиннее 200 знаков",
    specialtyOtherRequired: "Укажите специальность",
    specialtyOtherTooLong: "Не длиннее 120 знаков",
    specialtyUnknown: "Выберите специальность из списка",
    formatRequired: "Выберите формат",
    aboutTooLong: "Не длиннее 2000 знаков",
    consentRequired: "Отметьте согласие — без него заявку не отправить.",
    consentStale:
      "Текст согласия обновился — обновите страницу и отметьте согласие снова.",
  },
  unavailable: {
    lead: "Не удалось отправить — сервер недоступен.",
    rest: "Введённое сохранено.",
    retry: "Попробовать ещё раз",
  },
  sent: {
    title: "Заявка отправлена",
    text: "Администратор Академии разберёт её и свяжется с вами. Письмо «Заявка получена» придёт на почту вашей учётной записи.",
    another: "Отправить ещё одну заявку — про другой проект",
  },
} as const;

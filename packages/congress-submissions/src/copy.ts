import {
  CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG,
  type CongressSubmissionKind,
  type CongressSubmissionStatus,
} from "@ds/schemas";

/**
 * Every RU string of the section (046-design «Send cascade»: the package holds
 * the refusal copy dictionary). The strings are the canvas
 * `design-source/doctor-lk-congress.dc.html`, final layout А; the few the canvas
 * does not draw are marked `lead-proposed` and are confirmed at Stage B.
 */

export const STATUS_LABEL: Record<CongressSubmissionStatus, string> = {
  draft: "Черновик",
  submitted: "Отправлена",
  in_review: "На рассмотрении",
  accepted: "Принята",
  rejected: "Отклонена",
  needs_revision: "На доработке",
  withdrawn: "Отозвана",
};

/** The filter chip labels. */
export const STATUS_PLURAL: Record<CongressSubmissionStatus, string> = {
  draft: "Черновики",
  submitted: "Отправлены",
  in_review: "На рассмотрении",
  accepted: "Приняты",
  rejected: "Отклонены",
  needs_revision: "На доработке",
  withdrawn: "Отозваны",
};

export interface KindCopy {
  label: string;
  /** Genitive plural — «Приём {устных докладов} закрыт …». */
  gen: string;
  /** Nominative plural — the chooser note «{Устные доклады} принимаются до …». */
  nom: string;
  /** Plural forms for a count — one, few, many. */
  forms: readonly [string, string, string];
  /** Count forms after a number — «отправлено {3 тезиса}» — one, few, many. */
  countForms: readonly [string, string, string];
}

export const KIND_COPY: Record<CongressSubmissionKind, KindCopy> = {
  oral: {
    label: "Устный доклад",
    gen: "устных докладов",
    nom: "устные доклады",
    forms: ["устного доклада", "устных докладов", "устных докладов"],
    countForms: ["устный доклад", "устных доклада", "устных докладов"],
  },
  poster: {
    label: "Постерный доклад",
    gen: "постерных докладов",
    nom: "постерные доклады",
    forms: ["постерного доклада", "постерных докладов", "постерных докладов"],
    countForms: ["постерный доклад", "постерных доклада", "постерных докладов"],
  },
  abstract: {
    label: "Тезисы",
    gen: "тезисов",
    nom: "тезисы",
    forms: ["тезиса", "тезисов", "тезисов"],
    countForms: ["тезис", "тезиса", "тезисов"],
  },
};

export const COPY = {
  title: "Мои заявки на Конгресс",
  backToAccount: "← Аккаунт",
  backToList: "← Мои заявки",
  eventPage: "Страница Конгресса ↗",
  noRegistration: "Сначала зарегистрируйтесь участником Конгресса",
  registrationLink: "Регистрация на сайте Конгресса ↗",
  loadErrorTitle: "Не удалось загрузить заявки",
  loadErrorText:
    "Сервер не ответил. Черновики и отправленные заявки сохранены.",
  retry: "Повторить",
  newSubmission: "Новая заявка",
  newSubmissionButton: "+ Новая заявка",
  collapse: "Свернуть",
  start: "Начать заявку →",
  mySubmissions: "Мои заявки",
  all: "Все",
  untitled: "Без темы",
  committee: "Комитет: ",
  readWhole: "Читать целиком",
  committeeComment: "Комментарий программного комитета",
  sentMeta: "рассмотрит программный комитет, ответ придёт на почту",
  continue: "Продолжить",
  open: "Открыть",
  takeBack: "Забрать на исправление",
  withdraw: "Отозвать",
  withdrawAsk:
    "Отозвать заявку? Комитет её не рассмотрит, вернуть будет нельзя.",
  cancel: "Отмена",
  deleteDraft: "Удалить черновик",
  /** lead-proposed — EARS-13 asks for a confirmation the canvas does not draw. */
  deleteAsk: "Удалить черновик? Восстановить его будет нельзя.",
  sectionAbout: "О работе",
  onSite: "Формат участия — очный",
  topic: "Тема",
  topicPlaceholder:
    "Например: PRP при латеральном эпикондилите: результаты 120 пациентов",
  sectionAuthors: "Авторы",
  pickSpeaker: "Отметьте одного докладчика",
  authorOrder: "Порядок — как в публикации",
  speaker: "Докладчик",
  newAuthor: "Новый автор",
  noWorkplace: "место работы не указано",
  edit: "Изменить",
  done: "Готово",
  up: "Переместить выше",
  down: "Переместить ниже",
  upTitle: "Выше",
  downTitle: "Ниже",
  removeAuthor: "Удалить автора",
  addAuthor: "+ Добавить автора",
  surname: "Фамилия",
  firstName: "Имя",
  patronymic: "Отчество",
  workplace: "Место работы",
  sectionContent: "Содержание",
  goal: "Образовательная цель",
  goalPlaceholder: "Чему научится слушатель доклада",
  summary: "Краткое содержание",
  summaryPlaceholder: "О чём доклад: материал, случаи, выводы",
  posterGoal: "Цель",
  posterContent: "Содержание",
  /** 046 EARS-21 — the five abstract sections (canvas `DEFS.theses`). */
  abstractRelevance: "Актуальность",
  abstractGoal: "Цель",
  abstractMethods: "Материалы и методы",
  abstractResults: "Результаты и обсуждение",
  abstractConclusions: "Выводы",
  /** 046 EARS-21 — the abstract form's title label and text section (canvas). */
  abstractTitle: "Название тезисов",
  abstractText: "Текст тезисов",
  abstractTextSub: "Пять разделов, всего до 5 000 знаков",
  /** 046 EARS-25 — the canvas `thesesFrom` action. */
  abstractFrom: "Подать тезисы по этой работе",
  /** 046 EARS-23 — the statements (canvas `mkChk`, owner decision 2026-09-30). */
  statementPlag: "В тексте нет некорректных заимствований",
  statementTrade: "В тексте нет торговых наименований",
  errStatementPlag: "Подтвердите, что в тексте нет некорректных заимствований",
  errStatementTrade: "Подтвердите, что в тексте нет торговых наименований",
  birthDate: "Дата рождения",
  birthAskedOnce: "Спрашиваем один раз — перед первым постером.",
  errBirth: "Укажите дату рождения",
  sectionConfirmations: "Подтверждения",
  consentBefore: "Согласие на ",
  consentLink: "обработку персональных данных",
  saved: "Сохранено",
  saving: "Сохраняем…",
  saveFailed: "Не удалось сохранить — повторим",
  send: "Отправить",
  sendAgain: "Отправить снова",
  confirmTitle: "Отправить заявку в программный комитет?",
  confirmTitleAgain: "Отправить исправленную заявку?",
  confirmSub: "После отправки редактирование закроется.",
  /** 046 EARS-12 — while the kind is open; the date is its close day. */
  confirmTakeBackUntil: (day: string) =>
    `До ${day} заявку можно забрать на исправление. После — комитет рассмотрит отправленную версию.`,
  takeBackUntil: (day: string) => `Можно исправить до ${day}`,
  confirmSubAgain:
    "После отправки изменить её будет нельзя — комитет рассмотрит эту версию.",
  confirmYes: "Да, отправить",
  confirmYesAgain: "Да, отправить снова",
  /** lead-proposed — a send the server never answered (the canvas draws none). */
  sendFailed: "Не удалось отправить — попробуйте ещё раз",
  sentNotice:
    "Заявка отправлена. Рассмотрит программный комитет, ответ придёт на почту.",
  summarySaved: "Текст заявки сохранён.",
  /** lead-proposed — refusals the canvas draws no string for (046 EARS-9). */
  errStatusChanged: "Статус заявки изменился — отправить её сейчас нельзя",
  errWithdrawNotAllowed: "Статус заявки изменился — отозвать её сейчас нельзя",
  errKindNotAvailable: "Заявки этого вида пока не принимаются",
  errAgeLimit:
    "Возраст первого автора не подходит под условия этого вида заявок",
  errStatement: "Подтвердите обязательные заявления",
  errFieldInvalid: "Проверьте заполнение формы",
  errRevisionClosed: "Срок доработки истёк — отправить заявку нельзя",
  errTopic: "Укажите тему",
  errAuthors: "Заполните фамилию, имя и место работы у каждого автора",
  errSpeaker: "Отметьте одного докладчика",
  errConsent: "Дайте согласие на обработку персональных данных",
  notAnnounced: "Дату открытия приёма объявят позже",
} as const;

/**
 * 046 EARS-16 — the submission consent document the checkbox links to: its
 * feature-028 page `/documents/<slug>`, which every storefront serves, so the
 * path is host-relative and the same on every host.
 */
export const CONGRESS_SUBMISSION_CONSENT_HREF = `/documents/${CONGRESS_SUBMISSION_CONSENT_DOCUMENT_SLUG}`;

import {
  MOSCOW_TIME_ZONE,
  formatEventTime,
  revisionLastDay,
} from "@ds/schemas";

import { composeEmail, type EmailMessage } from "./email-layout.js";

/** 011 EARS-7: preserve recovery/reporting without secrets, counts or lock time. */
export function adminLockoutMessage(): EmailMessage {
  return composeEmail({
    subject:
      "Doctor.School — вход в панель администрирования временно заблокирован",
    preheader: "Вход в панель администрирования временно заблокирован",
    intro:
      "Мы временно заблокировали вход в панель администрирования Doctor.School " +
      "для вашей учётной записи: одноразовый код вводился неверно слишком " +
      "много раз подряд.",
    paragraphs: [
      "Пароль и данные учётной записи не изменились. Попробуйте войти позже.",
      "Если приложение-аутентификатор недоступно, обратитесь к техническому " +
        "руководителю — он снимет старый фактор, и вы подключите приложение заново.",
    ],
    footer: [
      "Если это были не вы, сообщите об этом техническому руководителю.",
      "Команда Doctor.School",
    ],
  });
}

/**
 * 046 «Letters» (owner 2026-10-06, #2634) — the congress letters carry no link,
 * button or URL. The way into the cabinet is told in text: the congress site's
 * «Войти в кабинет» button, its own domain written as plain text.
 */
const CONGRESS_AUTHOR_CABINET_ENTRY =
  "Чтобы открыть заявку, зайдите на сайт Конгресса orthobio.ru. В разделе " +
  "«Участникам» найдите «Как подать материалы» и нажмите «Войти в кабинет». " +
  "Войти можно по коду из письма, пароль не нужен.";

/** 046 EARS-15 amended — the 044 confirmation's line about the cabinet. */
const CONGRESS_CONFIRMATION_CABINET_ENTRY =
  "Подать материалы — устные и постерные доклады, тезисы — можно в личном " +
  "кабинете. Как войти: на сайте Конгресса orthobio.ru в разделе " +
  "«Участникам» найдите «Как подать материалы» и нажмите «Войти в кабинет».";

/**
 * 044 EARS-13 — what the congress confirmation email is rendered from: the
 * event, and nothing about the participant's account.
 *
 * One copy for every participant (production amendment 2026-09-24, #2369): the
 * letter carries no account-dependent branch and no link at all (046 EARS-15).
 */
export interface CongressConfirmationContent {
  /** The event's own title, as `events.title` holds it. */
  eventTitle: string;
  /** Already rendered for a human — see {@link formatCongressEventDate}. */
  eventDate: string;
  /** The congress venue, a per-deployment constant of THIS congress. */
  eventVenue: string;
}

/**
 * 044 EARS-13 — «{дата}» as the participant reads it: Moscow wall-clock.
 *
 * `events.starts_at` is a `timestamptz`, i.e. an instant; the mail must name the
 * moment the congress actually begins for the people attending it, and the
 * congress, the organiser and the audience are all in Moscow. Rendering the
 * instant in the server's local zone would silently shift a date the owner
 * approved whenever the API runs anywhere but `Europe/Moscow`, so the zone is
 * pinned to Moscow through the one event-time formatter.
 */
export function formatCongressEventDate(startsAt: Date): string {
  // Emails keep МСК (004 EARS-12 as amended): the one event-time formatter,
  // pinned to Moscow — «12 марта 2027 г. в 10:00».
  const { dateWithYear, time } = formatEventTime({
    startsAt,
    viewerZone: MOSCOW_TIME_ZONE,
  });
  return `${dateWithYear} в ${time}`;
}

/**
 * 044 EARS-13 — the congress confirmation email, rendered through the same
 * shared layout every other transactional mail uses.
 *
 * Carries no code, no token and no personal data beyond the event the reader
 * just signed up for: it belongs to the product-notice class of the
 * {@link import("./mailer.types.js").Mailer} port, not the credential class.
 * It has no action: the letter confirms the registration, says nothing about a
 * Doctor.School account (#2369), and carries no link, button or URL — one line
 * tells in text where the cabinet entry is on the congress site (046 EARS-15
 * amended, #2634) — the same letter for the site form and the desk.
 */
export function congressConfirmationMessage(
  content: CongressConfirmationContent,
): EmailMessage {
  const headline = `Вы зарегистрированы на ${content.eventTitle}`;
  return composeEmail({
    subject: `Doctor.School — вы зарегистрированы на ${content.eventTitle}`,
    preheader: headline,
    intro: `${headline}: ${content.eventDate}, ${content.eventVenue}.`,
    paragraphs: [CONGRESS_CONFIRMATION_CABINET_ENTRY],
    footer: [
      "Если это были не вы, просто проигнорируйте это письмо.",
      "Команда Doctor.School",
    ],
  });
}

/** 046 EARS-14 — what the submission receipt is rendered from. */
export interface CongressSubmissionReceiptContent {
  /** «{тема}» — the submission's title. */
  title: string;
  /** «{вид}» — the kind's name as the section shows it. */
  kindLabel: string;
  /** «{мероприятие}» — `events.title`, as the 044 confirmation names it. */
  eventTitle: string;
}

/**
 * 046 EARS-14 — the receipt the author gets once a submission is `submitted`
 * (copy approved at Stage A, 2026-09-30). A product notice: it names the
 * submission and the event and tells in text where the cabinet entry is, with
 * no link (046 «Letters», #2634), nothing else. The kind
 * is named in running text, so its section label is lower-cased
 * («устный доклад»).
 */
export function congressSubmissionReceiptMessage(
  content: CongressSubmissionReceiptContent,
): EmailMessage {
  const kind = content.kindLabel.toLocaleLowerCase("ru-RU");
  return composeEmail({
    subject: "Doctor.School — заявка получена",
    preheader: "Заявка получена",
    intro:
      `Ваша заявка «${content.title}» (${kind}) получена и передана ` +
      `программному комитету ${content.eventTitle}. Статус можно посмотреть ` +
      "в кабинете.",
    paragraphs: [CONGRESS_AUTHOR_CABINET_ENTRY],
    footer: ["Команда Doctor.School"],
  });
}

/**
 * 046 EARS-29, EARS-35 — what a committee decision or a deadline extension
 * letter is rendered from. `lastDay` is already rendered for a human — see
 * {@link formatRevisionLastDay}.
 */
export type CongressSubmissionDecisionContent = {
  /** «{тема}» — the submission's title. */
  title: string;
  /** «{вид}» — the kind's name as the section shows it. */
  kindLabel: string;
} & (
  | { letter: "accepted" }
  | { letter: "rejected"; comment: string }
  | { letter: "needs_revision"; comment: string; lastDay: string }
  | { letter: "revision_extended"; lastDay: string }
);

/**
 * 046 EARS-29, EARS-35 — «{дата}» of «до {дата}, 23:59 МСК»: the last day a
 * stored revision deadline keeps open (the day before the stored instant), as
 * a Moscow calendar date `ДД.ММ.ГГГГ` (046 V-12: «до 03.03.2027, 23:59 МСК»).
 */
export function formatRevisionLastDay(revisionDueAt: Date): string {
  const [year, month, day] = revisionLastDay(revisionDueAt).split("-");
  return `${day}.${month}.${year}`;
}

/**
 * 046 EARS-29 — closes a sentence written by someone else (the committee
 * comment) exactly once: a text already ending in `.` `!` `?` `…` (or `...`)
 * keeps its own mark, any other gets a full stop. Trailing whitespace is
 * dropped so the mark sits right after the last word (owner 2026-10-08, #2734:
 * no «иллюстрация.. Исправить»).
 */
export function endSentence(text: string): string {
  const trimmed = text.trimEnd();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * 046 EARS-29, EARS-35 — the author's letter after a committee decision
 * (`accepted`, `rejected`, `needs_revision`) or the platform administrator's
 * revision-deadline extension. Copy approved at Stage A (L-2, 2026-10-08,
 * #2437), verbatim. A product notice with no link, button or URL: like the
 * receipt it ends with the cabinet-entry paragraph (046 «Letters», #2634). The
 * committee comment is carried verbatim; the layout escapes it as text.
 */
export function congressSubmissionDecisionMessage(
  content: CongressSubmissionDecisionContent,
): EmailMessage {
  const kind = content.kindLabel.toLocaleLowerCase("ru-RU");
  const named = `«${content.title}» (${kind})`;
  const until = (lastDay: string) =>
    `Исправить и отправить заявку можно в кабинете до ${lastDay}, 23:59 МСК.`;
  let subject: string;
  let preheader: string;
  let intro: string;
  switch (content.letter) {
    case "accepted":
      subject = "Doctor.School — заявка принята";
      preheader = "Заявка принята";
      intro = `Программный комитет принял вашу заявку ${named}.`;
      break;
    case "rejected":
      subject = "Doctor.School — заявка отклонена";
      preheader = "Заявка отклонена";
      intro =
        `Программный комитет отклонил заявку ${named}. ` +
        `Комментарий комитета: ${content.comment}`;
      break;
    case "needs_revision":
      subject = "Doctor.School — заявку нужно доработать";
      preheader = "Заявку нужно доработать";
      intro =
        `Программный комитет просит доработать заявку ${named}: ` +
        `${endSentence(content.comment)} ${until(content.lastDay)}`;
      break;
    case "revision_extended":
      subject = "Doctor.School — срок доработки продлён";
      preheader = "Срок доработки продлён";
      intro =
        `Срок доработки заявки ${named} продлён. ` + until(content.lastDay);
      break;
  }
  return composeEmail({
    subject,
    preheader,
    intro,
    paragraphs: [CONGRESS_AUTHOR_CABINET_ENTRY],
    footer: ["Команда Doctor.School"],
  });
}

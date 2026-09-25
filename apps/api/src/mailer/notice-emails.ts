import { composeEmail, type EmailMessage } from "./email-layout.js";

/** 003 EARS-23/29: duplicate registration needs only the portal login action. */
export function accountExistsMessage(portalBaseUrl: string): EmailMessage {
  const loginUrl = `${portalBaseUrl.replace(/\/+$/, "")}/login`;
  return composeEmail({
    subject: "Doctor.School — у вас уже есть аккаунт",
    preheader: "У вас уже есть аккаунт Doctor.School",
    intro:
      "Мы получили попытку регистрации с этим адресом электронной почты, но " +
      "у вас уже есть аккаунт Doctor.School. Создавать новый не нужно.",
    paragraphs: [],
    action: { label: "Войти", url: loginUrl },
    footer: [
      "Если это были не вы, просто проигнорируйте это письмо — никаких " +
        "изменений в вашем аккаунте не произошло.",
      "Команда Doctor.School",
    ],
  });
}

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
 * 044 EARS-13 — what the congress confirmation email is rendered from: the
 * event, and nothing about the participant's account.
 *
 * One copy for every participant (production amendment 2026-09-24, #2369): the
 * letter only confirms the registration, so it carries no account-dependent
 * branch and no portal destination.
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
 * pinned here exactly as the events read model pins it
 * (`apps/api/src/events/events.repository.ts`).
 */
export function formatCongressEventDate(startsAt: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(startsAt);
}

/**
 * 044 EARS-13 — the congress confirmation email, rendered through the same
 * shared layout every other transactional mail uses.
 *
 * Carries no code, no token and no personal data beyond the event the reader
 * just signed up for: it belongs to the product-notice class of the
 * {@link import("./mailer.types.js").Mailer} port, not the credential class.
 * It has no action: the letter confirms the registration and says nothing
 * about a Doctor.School account or signing in (#2369).
 */
export function congressConfirmationMessage(
  content: CongressConfirmationContent,
): EmailMessage {
  const headline = `Вы зарегистрированы на ${content.eventTitle}`;
  return composeEmail({
    subject: `Doctor.School — вы зарегистрированы на ${content.eventTitle}`,
    preheader: headline,
    intro: `${headline}: ${content.eventDate}, ${content.eventVenue}.`,
    paragraphs: [],
    footer: [
      "Если это были не вы, просто проигнорируйте это письмо.",
      "Команда Doctor.School",
    ],
  });
}

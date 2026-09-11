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

import type { AccountProfileCardCopy } from "@ds/design-system/account-profile-card";

/**
 * Every fixed sentence of the account cabinet (wave-4 gate row 15) — the
 * Academy's `account` catalogue moved verbatim, word-identical to the doctor
 * cabinet's literals. The cabinet reads this default; no host overrides a word.
 */
export const ACCOUNT_COPY = {
  /** The loading status before the profile resolves (row 2). */
  loading: "Загружаем ваш профиль…",
  /** A non-401 read failure (row 6). */
  error: "Не удалось загрузить профиль. Обновите страницу.",
  /** The per-action generic a failed display-name save falls back to (row 10). */
  nameError: "Не удалось сохранить. Попробуйте ещё раз.",
  card: {
    title: "Профиль",
    subtitle: "Данные аккаунта, вход и сессия",
    sections: {
      profile: "Профиль",
      security: "Безопасность",
      session: "Сессия",
    },
    nameLabel: "Имя",
    nameEmpty: "не указано",
    nameEdit: "Изменить",
    nameAdd: "Указать",
    nameSave: "Сохранить",
    nameCancel: "Отмена",
    nameInputLabel: "Отображаемое имя",
    emailLabel: "Email",
    emailVerified: "подтверждён",
    phoneLabel: "Телефон",
    phoneEmpty: "не указан",
    phone: {
      add: "Добавить",
      confirm: "Подтвердить",
      change: "Изменить",
      verified: "подтверждён",
      unconfirmedHelper: "Не подтверждён — подтвердите, чтобы входить по SMS",
      suggestedHelper:
        "Из заявки на конгресс — подтвердите, чтобы входить по SMS",
      confirmedNote: "Телефон подтверждён. Теперь можно входить по коду из SMS",
      inputLabel: "Номер телефона",
      placeholder: "+7…",
      send: "Получить код",
      cancel: "Отмена",
      codeSentTo: "Код отправлен по SMS на",
      codeLabel: "Код из SMS",
      back: "← Изменить номер",
      resend: "Отправить снова",
      resendCountdown: (seconds: number) => `Отправить снова · ${seconds} с`,
      wrongCode: "Неверный код",
      throttled: "Слишком много попыток. Попробуйте позже",
      unavailable: "Сервис временно недоступен — попробуйте ещё раз.",
    },
    passwordLabel: "Пароль",
    passwordChange: "Сменить пароль",
    passwordHelper: "Отправим код для сброса пароля на email",
    eventsLabel: "События",
    eventsTitle: "Мои события",
    eventsHelper: "Эфиры, записи и сертификаты",
    // Row 14 — renders only on a host whose config names the congress section.
    congressTitle: "Мои заявки на Конгресс",
    signOut: "Выйти из аккаунта",
  } satisfies AccountProfileCardCopy,
} as const;

import { PASSWORD_MIN_LENGTH, PROMO_CODE_MAX_LENGTH } from "@ds/schemas";

import type { AuthFlowCopy } from "../host-config";

/**
 * The package's own words for every auth field, control and sentence.
 *
 * Owner rule (#2027): a field is ONE thing on both storefronts — its words, its
 * validation, its mask and its look belong to the package; a host varies only
 * the SET of fields it asks for. Every string here is verbatim from the
 * vendored canvas `design-source/auth.dc.html`, so the rendered door and the
 * approved design cannot drift.
 *
 * A host MAY override any single key through `AuthFlowHostConfig.copy`, a deep
 * partial merged over these defaults by `resolveAuthFlowCopy`. TODAY NO HOST
 * OVERRIDES ANYTHING — the override exists for a genuinely host-specific
 * sentence, not as a place to restate the shared wording.
 *
 * The two length sentences read the `@ds/schemas` SSOT, so the sentence a
 * visitor reads cannot drift from the rule that rejects them.
 */
export const DEFAULT_AUTH_FLOW_COPY: AuthFlowCopy = {
  errors: {
    tooManyAttempts: "Слишком много попыток — повторите через несколько минут.",
    unavailable: "Сервис временно недоступен — попробуйте ещё раз.",
    botProtectionRequired: "Подтвердите, что вы не робот.",
    botProtectionRejected:
      "Проверка истекла или не пройдена. Подтвердите ещё раз.",
  },
  botProtection: {
    required: "Подтвердите, что вы не робот.",
    rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
    unavailable:
      "Не удалось выполнить проверку. Проверьте подключение к интернету и попробуйте ещё раз.",
  },
  fields: {
    email: {
      required: "Заполните это поле.",
      invalid: "Введите корректный адрес электронной почты.",
    },
    password: {
      required: "Заполните это поле.",
      invalid: `Не менее ${PASSWORD_MIN_LENGTH} символов.`,
    },
    code: { required: "Введите код.", invalid: "Введите код." },
    promoCode: {
      invalid: `Промокод длиннее ${PROMO_CODE_MAX_LENGTH} символов — проверьте, что скопировали только код.`,
    },
    identifier: {
      required: "Заполните это поле.",
      invalid: "Укажите электронную почту или телефон.",
    },
    phone: {
      required: "Заполните это поле.",
      invalid: "Введите телефон в формате +79991234567.",
    },
  },
  login: {
    title: "Вход",
    description: "Доступ к вашему аккаунту Doctor.School.",
    createAccount: "Создать аккаунт",
    forgotPassword: "Забыли пароль?",
    methodSwitcherLabel: "Способ входа",
    methodPassword: "Пароль",
    methodOtp: "По коду",
    password: {
      formLabel: "Вход по паролю",
      identifierLabel: "Электронная почта или телефон",
      identifierPlaceholder: "doctor@example.com или +7…",
      passwordLabel: "Пароль",
      passwordPlaceholder: "••••••••",
      passwordRequired: "Заполните это поле.",
      reveal: {
        show: "Показать",
        hide: "Скрыть",
        showAria: "Показать пароль",
        hideAria: "Скрыть пароль",
      },
      submit: "Войти",
    },
    otp: {
      formLabel: "Вход по одноразовому коду",
      heading: "Вход по одноразовому коду",
      description: "Пришлём код на почту или телефон — пароль не нужен.",
      channelGroupLabel: "Канал кода",
      channelEmail: "Эл. почта",
      channelSms: "SMS",
      emailLabel: "Электронная почта",
      emailPlaceholder: "doctor@example.com",
      phoneLabel: "Телефон",
      phonePlaceholder: "+79991234567",
      sendCode: "Отправить код",
      verifyTitle: "Введите код для входа",
      sentTo: "Код отправлен на {destination}",
      codeLabel: "Код из сообщения",
      codeInvalid: "Введите код.",
      verifySubmit: "Подтвердить и войти",
      resend: "Отправить снова",
      resendCountdown: "Отправить снова · {seconds} с",
      changeMethod: "← Изменить способ",
    },
    failed: {
      password: "Не удалось войти. Проверьте данные и попробуйте снова.",
      otpRequest: "Не удалось отправить код. Попробуйте ещё раз.",
      otpVerify: "Код не подошёл. Запросите новый.",
    },
  },
  register: {
    title: "Создание аккаунта",
    description: "Бесплатно, за две минуты — нужны только e-mail и пароль.",
    emailLabel: "Электронная почта",
    emailPlaceholder: "doctor@example.com",
    passwordLabel: "Пароль",
    passwordPlaceholder: "••••••••",
    reveal: {
      show: "Показать",
      hide: "Скрыть",
      showAria: "Показать пароль",
      hideAria: "Скрыть пароль",
    },
    submit: "Создать аккаунт",
    promo: { label: "Промокод — если есть", placeholder: "MEDREP-2026" },
    partnerPlate:
      "Регистрация по ссылке партнёра — промокод подставлен автоматически.",
    haveAccount: "Уже есть аккаунт? Войти",
    failed: "Не удалось завершить регистрацию. Проверьте введённые данные.",
  },
  // Canvas «Подтверждение» (`design-source/auth.dc.html` 212-244, 405-443):
  // title/description `titles.verify`, the eyebrows, the resend label and its
  // notice, the success banner and the verify-screen `errText()` branches.
  verify: {
    title: "Проверьте почту",
    description:
      "Мы отправили код на {destination}. Введите его, чтобы завершить регистрацию.",
    newAccountHeading: "Новый аккаунт — введите код",
    codeLabel: "Код из письма",
    submit: "Подтвердить",
    codeAccepted: "Код принят — входим…",
    resend: "Отправить снова",
    resendCountdown: "Отправить снова · {seconds} с",
    existingAccountHeading: "Уже регистрировались?",
    existingAccountHint: "Войдите в существующий аккаунт или сбросьте пароль.",
    goToSignIn: "Войти",
    goToReset: "Сбросить пароль",
    failed: "Код не подошёл. Попробуйте ещё раз.",
    resendFailed: "Не удалось отправить код повторно. Попробуйте ещё раз.",
    resendAcknowledged:
      "Если регистрация ещё не подтверждена, мы повторно отправили код на {destination}.",
    missingIdentifier:
      "Не удалось определить аккаунт. Зарегистрируйтесь заново, чтобы получить новый код, или войдите в существующий аккаунт.",
    // Not a canvas string (the canvas always has an address): the shipped
    // Academy catalogue line for a bare deep-link.
    fallbackDestination: "ваш аккаунт",
  },
  consents: {
    accessGroupHeading: "Условия доступа",
    medicalWorkerDeclaration: {
      label: "Я являюсь медицинским работником",
      help: "Требование закона: часть материалов доступна только медицинским работникам.",
      unmet:
        "Отметьте, что вы медицинский работник — без этого регистрация невозможна.",
    },
    partnerDataItem: {
      label: "Согласие на передачу данных партнёрам платформы",
      help: "Это условие бесплатного для врача обучения: без согласия часть материалов недоступна.",
      unmet:
        "Отметьте согласие на передачу данных партнёрам — без него регистрация невозможна.",
    },
    marketingOptIn: {
      label: "Полезные письма о новых эфирах",
      help: "И другие уведомления о релевантных для Вас событиях. Отписаться можно в любой момент.",
    },
    statement:
      "Продолжая, вы соглашаетесь с условиями использования и политикой конфиденциальности.",
  },
  returnContext: {
    eyebrow: "Вы вернётесь к этому событию",
    login: "После входа вы вернётесь сюда же — место за вами.",
    register: "После подтверждения почты вы вернётесь сюда же — место за вами.",
  },
  brand: {
    eyebrow: "Врачи учат врачей",
    headline: "Медицинское образование для врачей",
    subcopy:
      "Учебные программы и сертификация от ведущих экспертов отрасли — в едином пространстве Doctor.School.",
    footer: "© Doctor.School. Платформа непрерывного медицинского образования.",
  },
  botProtectionDisclosure: {
    notice: "Форма защищена Yandex SmartCaptcha.",
    link: "Условия обработки данных.",
    linkLabel:
      "Условия обработки данных Yandex SmartCaptcha (откроются в новой вкладке)",
  },
};

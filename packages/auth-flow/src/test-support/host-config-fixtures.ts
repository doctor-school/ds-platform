import type { AuthFlowHostConfig } from "../host-config";

/**
 * The two host shapes the package units are exercised against (#2027).
 *
 * Fixtures, not the hosts' own configs: a package may not import from an app
 * (ADR-0013 A1), and the point of every case below is the BRANCH the package
 * owns, never the sentence a host chose. The sentences here therefore mirror the
 * shipped ones only closely enough that an assertion can tell two branches apart.
 */

/** The Academy: an email-or-SMS host whose registration form has no promo box. */
export const ACADEMY_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/auth/register",
    confirmPath: "/v1/auth/verify",
  },
  routes: {
    login: "/login",
    register: "/register",
    verify: "/verify",
    reset: "/reset",
    account: "/account",
    // 003 EARS-28 - the /account change-password action hands off here, so a
    // signed-in visitor must be able to finish a reset.
    allowAuthenticated: ["/reset"],
    eventPathTemplate: "/webinars/:slug",
    room: "/webinars/:slug/room",
  },
  landing: { afterLogin: "/webinars", specialtyAware: false },
  copy: {
    errors: {
      tooManyAttempts:
        "Слишком много попыток — повторите через несколько минут.",
      unavailable: "Сервис временно недоступен — попробуйте ещё раз.",
      botProtectionRequired: "Подтвердите, что вы не робот.",
      botProtectionRejected:
        "Проверка истекла или не пройдена. Подтвердите ещё раз.",
    },
    botProtection: {
      required: "Подтвердите, что вы не робот.",
      rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
      unavailable: "Не удалось выполнить проверку.",
    },
    fields: {
      email: {
        required: "Заполните это поле.",
        invalid: "Введите корректный адрес электронной почты.",
      },
      password: {
        required: "Заполните это поле.",
        invalid: "Не менее 8 символов.",
      },
      code: { required: "Введите код.", invalid: "Введите код." },
      identifier: {
        required: "Укажите электронную почту или телефон.",
        invalid: "Укажите электронную почту или телефон.",
      },
      phone: {
        required: "Введите телефон в формате +79991234567.",
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
        passwordRequired: "Не менее 8 символов.",
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
        phonePlaceholder: "+7…",
        sendCode: "Отправить код",
        verifyTitle: "Введите код для входа",
        sentTo: "Код отправлен на {destination}",
        codeLabel: "Введите код",
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
    brand: {
      eyebrow: "Врачи учат врачей",
      headline: "Медицинское образование для врачей",
      subcopy: "Учебные программы и сертификация от ведущих экспертов отрасли.",
      footer:
        "© Doctor.School. Платформа непрерывного медицинского образования.",
    },
    botProtectionDisclosure: {
      notice: "Форма защищена Yandex SmartCaptcha.",
      link: "Условия обработки данных.",
      linkLabel:
        "Условия обработки данных Yandex SmartCaptcha (откроются в новой вкладке)",
    },
  },
  brand: {
    wordmark: {
      src: "/brand/logo.svg",
      alt: "Doctor.School",
      width: 500,
      height: 164,
    },
    panel: { src: "/brand/logo-white.svg", width: 500, height: 164 },
    loginIcon: "shield-check",
  },
  botProtection: { siteKey: undefined },
  channels: ["email", "sms"],
  register: { promoField: false },
  // 014 EARS-6 - this host parks the carried target for the trip through the
  // verification mail. The doctor fixture below states none: row 29, that host
  // carries the target on the query param alone.
  returnTo: { parkingCookie: { name: "ds_return_to", maxAgeSeconds: 900 } },
};

/** The doctor storefront: email-only sign-in codes, promo box on the form. */
export const DOCTOR_FIXTURE: AuthFlowHostConfig = {
  api: {
    basePath: "/v1/auth",
    registerPath: "/v1/storefront/doctor/register",
    confirmPath: "/v1/storefront/doctor/confirm",
  },
  routes: {
    login: "/login",
    register: "/register",
    // Confirmation is an inline step of this host registration screen, not a
    // route of its own - `undefined` is that fact, not a missing value.
    reset: "/reset",
    account: "/account",
    allowAuthenticated: ["/reset"],
    eventPathTemplate: "/events/:slug",
  },
  landing: {
    afterLogin: "/",
    specialtyAware: true,
    specialtyFeed: "/events",
    specialtyEndpoints: {
      signedIn: "/v1/me/specialty",
      guest: "/v1/public/specialty-choice",
      consumptionDeferredHeader: "x-ds-specialty-consumption-deferred",
    },
  },
  copy: {
    errors: {
      tooManyAttempts:
        "Слишком много попыток. Подождите пару минут и попробуйте снова.",
      unavailable:
        "Сервис временно недоступен. Попробуйте ещё раз через минуту.",
      botProtectionRequired:
        "Нужна дополнительная проверка. Подтвердите, что вы не робот.",
      botProtectionRejected:
        "Нужна дополнительная проверка — она истекла или не пройдена.",
    },
    botProtection: {
      required: "Подтвердите, что вы не робот.",
      rejected: "Проверка истекла или не пройдена. Подтвердите ещё раз.",
      unavailable: "Не удалось выполнить проверку.",
    },
    fields: {
      email: {
        required: "Введите рабочую почту — на неё придёт код подтверждения.",
        invalid: "Проверьте адрес: он должен быть вида doctor@clinic.ru.",
      },
      password: {
        required: "Придумайте пароль не короче 8 символов.",
        invalid: "Пароль слишком короткий — нужно не менее 8 символов.",
      },
      promoCode: {
        invalid:
          "Промокод длиннее 64 символов — проверьте, что скопировали только код.",
      },
      code: { invalid: "Введите код из письма." },
      identifier: {
        required: "Введите почту или телефон.",
        invalid:
          "Проверьте: почта вида doctor@clinic.ru или телефон в формате +79991234567.",
      },
      phone: {
        required: "Введите почту или телефон.",
        invalid: "Проверьте номер: он должен быть в формате +79991234567.",
      },
    },
    login: {
      title: "Вход",
      description: "Войдите, чтобы участвовать в эфирах и получать баллы НМО.",
      createAccount: "Создать аккаунт",
      forgotPassword: "Забыли пароль?",
      methodSwitcherLabel: "Способ входа",
      methodPassword: "По паролю",
      methodOtp: "По коду",
      password: {
        formLabel: "Вход по паролю",
        identifierLabel: "Почта или телефон",
        identifierPlaceholder: "doctor@clinic.ru",
        passwordLabel: "Пароль",
        passwordRequired: "Введите пароль.",
        submit: "Войти",
      },
      otp: {
        formLabel: "Вход по одноразовому коду",
        heading: "Вход без пароля",
        description: "Пришлём одноразовый код — пароль вводить не нужно.",
        channelGroupLabel: "Куда прислать код",
        channelEmail: "На почту",
        channelSms: "В СМС",
        emailLabel: "Рабочая почта",
        emailPlaceholder: "doctor@clinic.ru",
        phoneLabel: "Телефон",
        phonePlaceholder: "+7 999 123-45-67",
        sendCode: "Прислать код",
        verifyTitle: "Введите код",
        sentTo: "Код отправлен на {destination}",
        codeLabel: "Код из сообщения",
        codeInvalid: "Код состоит из 8 цифр — проверьте, что ввели все.",
        verifySubmit: "Войти",
        resend: "Прислать код ещё раз",
        resendCountdown: "Отправить снова можно через {seconds} с",
        changeMethod: "Другой способ входа",
      },
      failed: {
        password: "Не удалось войти. Проверьте почту или телефон и пароль.",
        otpRequest:
          "Не удалось отправить код. Проверьте адрес или номер и повторите.",
        otpVerify: "Код не подошёл. Проверьте цифры или запросите новый.",
      },
    },
    returnContext: {
      eyebrow: "Вы вернётесь к этому событию",
      login: "После входа вы вернётесь сюда же — место за вами.",
      register:
        "После подтверждения почты вы вернётесь сюда же — место за вами.",
    },
    brand: {
      eyebrow: "Врачи учат врачей",
      headline: "Учитесь у практикующих врачей",
      subcopy:
        "Бесплатные эфиры, записи и сертификаты НМО — от практикующих врачей.",
      footer: "Бесплатно для врача · без бюрократии · © Doctor.School 2026",
    },
    botProtectionDisclosure: {
      notice: "Форма защищена Yandex SmartCaptcha.",
      link: "Условия обработки данных",
      linkLabel:
        "Условия обработки данных Yandex SmartCaptcha — откроются в новой вкладке",
    },
  },
  brand: {
    wordmark: {
      src: "/brand/logo.svg",
      darkSrc: "/brand/logo-white.svg",
      alt: "Doctor.School",
      width: 500,
      height: 164,
    },
    panel: { src: "/brand/logo-white.svg", width: 500, height: 164 },
    loginIcon: "shield-check-square",
  },
  botProtection: { siteKey: undefined },
  channels: ["email"],
  register: { promoField: true },
  // Row 46 - the doctor door publishes the return context beside the form; it
  // parks nothing (row 29), so there is no cookie here.
  returnTo: { card: true },
};

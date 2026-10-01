import { LoginCard } from '@ds/design-system';

// OtpFocusScreen needs a react-hook-form `field` from a <FormField> Controller;
// its real mount is LoginCard's code stage (sentIdentifier set), which is what
// this preview renders — the focus screen replaces the request form.

const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden focusable="false">
    <path d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z" strokeWidth="2" strokeLinecap="square" />
    <path d="m9 12 2 2 4-4" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const copy = {
  title: 'Вход',
  description: 'Доступ к вашему аккаунту Doctor.School.',
  createAccount: 'Создать аккаунт',
  forgotPassword: 'Забыли пароль?',
  methodSwitcherLabel: 'Способ входа',
  methodPassword: 'Пароль',
  methodOtp: 'По коду',
  password: {
    formLabel: 'Вход по паролю',
    identifierLabel: 'Электронная почта или телефон',
    identifierPlaceholder: 'doctor@example.com или +7…',
    passwordLabel: 'Пароль',
    submit: 'Войти',
  },
  otp: {
    formLabel: 'Вход по одноразовому коду',
    heading: 'Вход по одноразовому коду',
    description: 'Пришлём код на почту или телефон — пароль не нужен.',
    channelGroupLabel: 'Канал кода',
    channelEmail: 'Эл. почта',
    channelSms: 'SMS',
    emailLabel: 'Электронная почта',
    emailPlaceholder: 'doctor@example.com',
    phoneLabel: 'Телефон',
    phonePlaceholder: '+79991234567',
    sendCode: 'Отправить код',
    verifyTitle: 'Введите код для входа',
    sentTo: (destination: string) => `Код отправлен на ${destination}`,
    codeLabel: 'Код из сообщения',
    verifySubmit: 'Подтвердить и войти',
    resend: 'Отправить снова',
    resendCountdown: (seconds: number) => `Отправить снова · ${seconds} с`,
    changeMethod: '← Изменить способ',
  },
};

// Permissive resolver: the host owns validation, the block just forwards values.
const passThrough = async <T,>(values: T) => ({ values, errors: {} });

const CodeStage = ({
  sentIdentifier,
  screenError,
}: {
  sentIdentifier: string;
  screenError?: string;
}) => (
  <div style={{ width: 420 }}>
    <LoginCard
      copy={copy}
      links={{ register: '#', reset: '#' }}
      icon={<ShieldGlyph />}
      defaultMethod="otp"
      password={{ resolver: passThrough, onSubmit: () => {} }}
      otp={{
        requestResolvers: { email: passThrough, sms: passThrough },
        verifyResolver: passThrough,
        sentIdentifier,
        resendNonce: 0,
        screenError,
        onRequest: () => {},
        onResend: () => {},
        onVerify: () => {},
        onChangeMethod: () => {},
      }}
    />
  </div>
);

export const EmailCode = () => <CodeStage sentIdentifier="doctor@example.ru" />;

// The DS error banner opens with a warning glyph; the capture harness reads a cell whose
// text starts with that glyph as a crashed cell, so a screen-reader caption leads it.
export const SmsCodeWithError = () => (
  <>
    <span className="sr-only">Состояние с ошибкой</span>
    <CodeStage
      sentIdentifier="+79000000000"
      screenError="Код не подошёл. Запросите новый."
    />
  </>
);

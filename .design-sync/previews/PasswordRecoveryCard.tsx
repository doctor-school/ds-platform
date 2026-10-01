import { PasswordRecoveryCard } from '@ds/design-system';

const KeyGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden focusable="false">
    <path d="M8 13a4 4 0 1 0-4-4" />
    <path d="M8 9l12 12" />
    <path d="M17 18l2-2" />
    <path d="M19 16l2-2" />
  </svg>
);

const copy = {
  title: 'Сброс пароля',
  titleComplete: 'Новый пароль',
  descriptionRequest: 'Укажите e-mail или телефон — пришлём код для сброса.',
  descriptionComplete: (destination: string) =>
    `Код отправлен на ${destination}. Введите его и задайте новый пароль.`,
  backToSignIn: '← Вернуться ко входу',
  request: {
    identifierLabel: 'Электронная почта или телефон',
    identifierPlaceholder: 'doctor@example.com или +7…',
    submit: 'Отправить код сброса',
  },
  complete: {
    codeLabel: 'Код из сообщения',
    newPasswordLabel: 'Новый пароль',
    passwordPolicyHint: 'Не менее 8 символов.',
    submit: 'Задать новый пароль',
    startOver: 'Начать заново',
    resend: 'Отправить снова',
    resendCountdown: (seconds: number) => `Отправить снова · ${seconds} с`,
  },
};

// Permissive resolver: the host owns validation, the block just forwards values.
const passThrough = async <T,>(values: T) => ({ values, errors: {} });

const Recovery = ({
  stage,
  notice,
  error,
}: {
  stage: 'request' | 'complete';
  notice?: string;
  error?: string;
}) => (
  <div style={{ width: 420 }}>
    <PasswordRecoveryCard
      copy={copy}
      stage={stage}
      identifier={stage === 'request' ? '' : 'doctor@example.ru'}
      links={{ login: '#' }}
      icon={<KeyGlyph />}
      request={{ resolver: passThrough, onSubmit: () => {} }}
      complete={{
        resolver: passThrough,
        onSubmit: () => {},
        resendNonce: 0,
        onResend: () => {},
        onRestart: () => {},
        notice,
        error,
      }}
    />
  </div>
);

export const Request = () => <Recovery stage="request" />;

export const Complete = () => <Recovery stage="complete" />;

export const ResendAcknowledged = () => (
  <Recovery
    stage="complete"
    notice="Если для этого адреса есть аккаунт, мы повторно отправили код."
  />
);

// The DS error banner opens with a warning glyph; the capture harness reads a cell whose
// text starts with that glyph as a crashed cell, so a screen-reader caption leads it.
export const CompleteError = () => (
  <>
    <span className="sr-only">Состояние с ошибкой</span>
    <Recovery stage="complete" error="Код не подошёл или пароль отклонён." />
  </>
);

import { EmailConfirmCard, maskDestination } from '@ds/design-system';

const MailCheckGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden focusable="false">
    <path d="M3 6h18v12H3z" />
    <path d="M3 7l9 6 9-6" />
    <path d="M8 20l3 3 6-6" />
  </svg>
);

const copy = {
  title: 'Проверьте почту',
  description: (destination: string) =>
    `Мы отправили код на ${destination}. Введите его, чтобы завершить регистрацию.`,
  newAccountHeading: 'Новый аккаунт — введите код',
  codeLabel: 'Код из письма',
  submit: 'Подтвердить',
  codeAccepted: 'Код принят — входим…',
  resend: 'Отправить снова',
  resendCountdown: (seconds: number) => `Отправить снова · ${seconds} с`,
  existingAccountHeading: 'Уже регистрировались?',
  existingAccountHint: 'Войдите в существующий аккаунт или сбросьте пароль.',
  goToSignIn: 'Войти',
  goToReset: 'Сбросить пароль',
};

// Permissive resolver: the host owns validation, the block just forwards values.
const passThrough = async <T,>(values: T) => ({ values, errors: {} });
const EMAIL = 'doctor@example.ru';

const Confirm = ({
  succeeded = false,
  withResend = true,
  notice,
  error,
}: {
  succeeded?: boolean;
  withResend?: boolean;
  notice?: string;
  error?: string;
}) => (
  <div style={{ width: 420 }}>
    <EmailConfirmCard
      copy={copy}
      email={EMAIL}
      destination={maskDestination(EMAIL)}
      resolver={passThrough}
      onSubmit={() => {}}
      succeeded={succeeded}
      error={error}
      links={{ login: '#', reset: '#' }}
      icon={<MailCheckGlyph />}
      resend={withResend ? { nonce: 0, onResend: () => {}, notice } : undefined}
    />
  </div>
);

export const AwaitingCode = () => <Confirm />;

export const Accepted = () => <Confirm succeeded />;

// The DS error banner opens with a warning glyph; the capture harness reads a cell whose
// text starts with that glyph as a crashed cell, so a screen-reader caption leads it.
export const WrongCode = () => (
  <>
    <span className="sr-only">Состояние с ошибкой</span>
    <Confirm error="Код не подошёл. Попробуйте ещё раз." />
  </>
);

export const ResendAcknowledged = () => (
  <Confirm notice="Если регистрация ещё не подтверждена, мы повторно отправили код на этот адрес." />
);

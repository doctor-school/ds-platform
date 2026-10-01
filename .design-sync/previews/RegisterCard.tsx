import { Link, RegisterCard } from '@ds/design-system';

const UserPlusGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden focusable="false">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeWidth="2" strokeLinecap="square" />
    <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" strokeWidth="2" strokeLinecap="square" />
    <path d="M19 8v6" strokeWidth="2" strokeLinecap="square" />
    <path d="M22 11h-6" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const copy = {
  title: 'Создание аккаунта',
  description: 'За две минуты — нужны только e-mail и пароль.',
  emailLabel: 'Электронная почта',
  emailPlaceholder: 'doctor@example.com',
  passwordLabel: 'Пароль',
  passwordPlaceholder: '••••••••',
  passwordPolicyHint: 'Не менее 8 символов.',
  submit: 'Создать аккаунт',
  accessGroupHeading: 'Условия доступа',
};

const consentItems = [
  {
    id: 'medicalWorkerDeclaration',
    tier: 'access' as const,
    label: 'Я являюсь медицинским работником',
    help: 'Требование закона: часть материалов доступна только медицинским работникам.',
    unmetMessage:
      'Отметьте, что вы медицинский работник — без этого регистрация невозможна.',
  },
  {
    id: 'partnerDataSharing',
    tier: 'access' as const,
    label: 'Согласие на передачу данных партнёрам платформы',
    help: 'Без согласия часть учебных материалов недоступна.',
    unmetMessage:
      'Отметьте согласие на передачу данных партнёрам — без него регистрация невозможна.',
  },
  {
    id: 'marketingCommunications',
    tier: 'marketing' as const,
    label: 'Полезные письма о новых эфирах',
    help: 'И другие уведомления о релевантных для Вас событиях. Отписаться можно в любой момент.',
  },
];

const Register = (props: Record<string, unknown>) => (
  <div style={{ width: 460 }}>
    <RegisterCard
      icon={<UserPlusGlyph />}
      copy={copy}
      consentItems={consentItems}
      promo={{ label: 'Промокод — если есть', placeholder: 'MEDREP-2026' }}
      footer={
        <Link href="#" variant="standalone">
          Уже есть аккаунт? Войти
        </Link>
      }
      belowFieldsSlot={
        <p className="text-xs leading-prose text-faint">
          Продолжая, вы соглашаетесь с условиями использования и политикой
          конфиденциальности.
        </p>
      }
      onSubmit={() => {}}
      {...props}
    />
  </div>
);

export const Default = () => <Register />;

export const PartnerLinkWithPoints = () => (
  <Register
    partnerPlateSlot={
      <p className="text-sm text-muted-foreground">
        Регистрация по ссылке партнёра — промокод подставлен автоматически.
      </p>
    }
    aboveSubmitSlot={
      <p className="text-sm text-muted-foreground">
        За регистрацию начислим 20 Pul на ваш счёт.
      </p>
    }
  />
);

// The DS error banner opens with a warning glyph; the capture harness reads a cell whose
// text starts with that glyph as a crashed cell, so a screen-reader caption leads it.
export const CommandError = () => (
  <>
    <span className="sr-only">Состояние с ошибкой</span>
    <Register
      errors={{
        command: 'Не удалось завершить регистрацию. Проверьте введённые данные.',
      }}
    />
  </>
);

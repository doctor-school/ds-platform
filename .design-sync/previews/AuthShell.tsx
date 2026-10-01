import { AuthCard, AuthShell, Button, Input, Label, Link, WebinarCard } from '@ds/design-system';

const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden focusable="false">
    <path d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z" strokeWidth="2" strokeLinecap="square" />
    <path d="m9 12 2 2 4-4" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const Wordmark = () => (
  <span className="text-lg font-extrabold text-foreground">Doctor.School</span>
);

const PanelMark = () => (
  <span className="text-lg font-extrabold text-primary-surface-foreground">
    Doctor.School
  </span>
);

const copy = {
  eyebrow: 'Врачи учат врачей',
  headline: 'Медицинское образование для врачей',
  subcopy:
    'Учебные программы и сертификация от ведущих экспертов отрасли — в едином пространстве Doctor.School.',
  footer: '© Doctor.School. Платформа непрерывного медицинского образования.',
};

const SignIn = () => (
  <AuthCard
    icon={<ShieldGlyph />}
    title="Вход"
    description="Доступ к вашему аккаунту Doctor.School."
    footer={
      <Link href="#" variant="standalone">
        Создать аккаунт
      </Link>
    }
  >
    <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="authshell-id">Электронная почта или телефон</Label>
        <Input id="authshell-id" placeholder="doctor@example.com или +7…" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="authshell-pw">Пароль</Label>
        <Input id="authshell-pw" type="password" placeholder="••••••••" />
      </div>
      <Button type="submit" className="w-full">
        Войти
      </Button>
    </form>
  </AuthCard>
);

const ReturnContext = () => (
  <div className="flex flex-1 flex-col justify-center gap-5 py-8">
    <p className="text-eyebrow font-extrabold uppercase tracking-eyebrow text-primary-surface-soft">
      Вы вернётесь к этому событию
    </p>
    <div className="light max-w-xl">
      <WebinarCard
        navigable={false}
        tzLabel="МСК"
        time="19:00"
        dateLabel="16 июля · ср"
        school="Школа травматологии и ортопедии"
        title="Пластика ахиллова сухожилия: разбор клинических случаев"
        specialties={['Травматология', 'Ортопедия']}
        speakers={[{ name: 'Анна Соколова', org: 'Травматолог-ортопед, к.м.н.' }]}
      />
    </div>
    <p className="max-w-panel-assurance text-sm leading-assurance text-primary-surface-soft">
      После входа вы вернётесь сюда же — место за вами.
    </p>
  </div>
);

export const Resting = () => (
  <div className="w-full">
    <AuthShell
      className="min-h-0"
      logo={<Wordmark />}
      panelMark={<PanelMark />}
      copy={copy}
    >
      <SignIn />
    </AuthShell>
  </div>
);

export const WithReturnContext = () => (
  <div className="w-full">
    <AuthShell
      className="min-h-0"
      logo={<Wordmark />}
      panelMark={<PanelMark />}
      copy={copy}
      returnContext={<ReturnContext />}
    >
      <SignIn />
    </AuthShell>
  </div>
);

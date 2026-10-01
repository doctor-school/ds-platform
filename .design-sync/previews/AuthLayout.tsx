import { AuthCard, AuthLayout, Button, Input, Label, Link } from '@ds/design-system';

const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden focusable="false">
    <path d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z" strokeWidth="2" strokeLinecap="square" />
    <path d="m9 12 2 2 4-4" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const Wordmark = () => (
  <span className="text-lg font-extrabold text-foreground">Doctor.School</span>
);

const BrandAside = () => (
  <div className="flex h-full flex-col justify-between gap-8">
    <div className="flex flex-1 flex-col justify-center gap-5">
      <p className="text-eyebrow font-extrabold uppercase tracking-micro text-primary-surface-muted">
        Врачи учат врачей
      </p>
      <p className="max-w-lg text-3xl font-extrabold leading-tight tracking-tight">
        Медицинское образование для врачей
      </p>
      <p className="max-w-md text-lg leading-snug text-primary-surface-muted">
        Учебные программы и сертификация от ведущих экспертов отрасли — в едином
        пространстве Doctor.School.
      </p>
    </div>
    <p className="text-sm font-semibold text-primary-surface-muted">
      © Doctor.School. Платформа непрерывного медицинского образования.
    </p>
  </div>
);

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
        <Label htmlFor="authlayout-id">Электронная почта или телефон</Label>
        <Input id="authlayout-id" placeholder="doctor@example.com или +7…" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="authlayout-pw">Пароль</Label>
        <Input id="authlayout-pw" type="password" placeholder="••••••••" />
      </div>
      <Button type="submit" className="w-full">
        Войти
      </Button>
    </form>
  </AuthCard>
);

export const SplitWithBrandPanel = () => (
  <div className="w-full">
    <AuthLayout className="min-h-0" logo={<Wordmark />} aside={<BrandAside />}>
      <SignIn />
    </AuthLayout>
  </div>
);

export const FormOnly = () => (
  <div className="w-full">
    <AuthLayout className="min-h-0" logo={<Wordmark />}>
      <SignIn />
    </AuthLayout>
  </div>
);

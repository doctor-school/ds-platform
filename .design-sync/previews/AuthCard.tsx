import { AuthCard, Button, Input, Label, Link } from '@ds/design-system';

const ShieldGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden focusable="false">
    <path d="M12 2 4 5v6c0 5 3.4 9.1 8 11 4.6-1.9 8-6 8-11V5l-8-3Z" strokeWidth="2" strokeLinecap="square" />
    <path d="m9 12 2 2 4-4" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

const SignInFields = () => (
  <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
    <div className="flex flex-col gap-2">
      <Label htmlFor="authcard-id">Электронная почта или телефон</Label>
      <Input id="authcard-id" placeholder="doctor@example.com или +7…" />
    </div>
    <div className="flex flex-col gap-2">
      <Label htmlFor="authcard-pw">Пароль</Label>
      <Input id="authcard-pw" type="password" placeholder="••••••••" />
    </div>
    <Button type="submit" className="w-full">
      Войти
    </Button>
  </form>
);

export const AllSlots = () => (
  <div style={{ width: 400 }}>
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
      <SignInFields />
    </AuthCard>
  </div>
);

export const RequiredOnly = () => (
  <div style={{ width: 400 }}>
    <AuthCard title="Сброс пароля">
      <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="authcard-reset">Электронная почта или телефон</Label>
          <Input id="authcard-reset" placeholder="doctor@example.com или +7…" />
        </div>
        <Button type="submit" className="w-full">
          Отправить код сброса
        </Button>
      </form>
    </AuthCard>
  </div>
);

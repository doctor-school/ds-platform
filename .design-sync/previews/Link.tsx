import { Link } from '@ds/design-system';

export const Inline = () => (
  <p className="text-sm text-foreground" style={{ width: 420 }}>
    Регистрируясь, вы принимаете{' '}
    <Link href="#" variant="inline">
      условия обработки персональных данных
    </Link>{' '}
    и правила начисления баллов НМО.
  </p>
);

export const Standalone = () => (
  <div className="flex flex-wrap items-center gap-4">
    <Link href="#">Все эфиры</Link>
    <Link href="#" size="sm">
      Архив записей
    </Link>
    <Link href="#" tone="muted" size="caption" weight="semibold">
      Отменить запись
    </Link>
    <Link href="#" tone="danger" size="caption">
      Удалить аккаунт
    </Link>
    <Link href="#" aria-disabled="true">
      Недоступно
    </Link>
  </div>
);

export const OnPrimary = () => (
  <p className="bg-primary-surface p-4 text-sm text-primary-surface-foreground" style={{ width: 420 }}>
    Нажимая кнопку, вы соглашаетесь с{' '}
    <Link href="#" variant="inline" tone="on-primary">
      политикой конфиденциальности
    </Link>
    .
  </p>
);

export const HeaderNav = () => (
  <div className="flex items-center gap-4 bg-header p-4">
    <Link href="#" tone="header-nav" size="sm">
      Мероприятия
    </Link>
    <Link href="#" tone="header-nav" size="sm">
      Академия
    </Link>
    <Link href="#" tone="header-nav" size="sm">
      Курсы НМО
    </Link>
  </div>
);

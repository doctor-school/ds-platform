import { Button } from '@ds/design-system';

export const Primary = () => <Button>Записаться на вебинар</Button>;

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-4">
    <Button variant="default">Сохранить</Button>
    <Button variant="secondary">Черновик</Button>
    <Button variant="outline">Отмена</Button>
    <Button variant="ghost">Пропустить</Button>
    <Button variant="destructive">Удалить запись</Button>
    <Button variant="link">Подробнее</Button>
  </div>
);

export const OnPrimarySurface = () => (
  <div className="flex flex-wrap items-center gap-4 bg-primary-surface p-4">
    <Button variant="on-primary">Смотреть эфир</Button>
    <Button variant="on-primary" loading>
      Подключаемся…
    </Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-4">
    <Button size="sm">Подтвердить</Button>
    <Button size="default">Продолжить</Button>
    <Button size="lg">Зарегистрироваться</Button>
    <Button size="icon" aria-label="Добавить в календарь">
      +
    </Button>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-4">
    <Button loading>Сохраняем…</Button>
    <Button disabled>Недоступно</Button>
    <Button variant="outline" disabled>
      Недоступно
    </Button>
  </div>
);

import { Button, EmptyState, Link } from '@ds/design-system';

export const NoRecords = () => (
  <EmptyState
    variant="no-records"
    title="Направлений пока нет"
    description="Создайте первое направление — специальности привяжутся к нему."
    action={<Button size="sm">Создать направление</Button>}
  />
);

export const NoResults = () => (
  <EmptyState
    variant="no-results"
    title="Ничего не найдено"
    description="По запросу «кардио» и фильтру «Черновики» нет ни одной записи."
    action={
      <Button variant="outline" size="sm">
        Сбросить фильтры
      </Button>
    }
  />
);

export const LoadError = () => (
  <EmptyState
    variant="error"
    title="Не удалось загрузить список документов."
    action={
      <Button variant="outline" size="sm">
        Повторить
      </Button>
    }
  />
);

export const NotFound = () => (
  <EmptyState
    variant="not-found"
    title="Такого документа нет."
    description="Возможно, ссылка устарела."
    action={
      <Link href="#" variant="standalone">
        Все документы платформы →
      </Link>
    }
  />
);

export const Loading = () => <EmptyState variant="loading" />;

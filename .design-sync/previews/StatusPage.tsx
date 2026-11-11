import { Button, StatusPage } from '@ds/design-system';

export const NotFound = () => (
  <div style={{ width: 720 }}>
    <StatusPage
      title="Такой страницы нет"
      text="Ссылка устарела или в ней опечатка."
      actions={
        <>
          <Button>На главную</Button>
          <Button variant="outline">Назад</Button>
        </>
      }
    />
  </div>
);

export const StackedWayOut = () => (
  <div style={{ width: 720 }}>
    <StatusPage
      title="Вход недоступен"
      text="Этот способ входа сейчас не работает."
      actionsLayout="stack"
      actions={
        <>
          <Button>Войти другим способом</Button>
          <p className="text-sm text-muted-foreground">Или напишите в поддержку: info@doctor.school</p>
        </>
      }
    />
  </div>
);

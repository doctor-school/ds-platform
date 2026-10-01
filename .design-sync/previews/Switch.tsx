import { Switch } from '@ds/design-system';

export const WithLabel = () => <Switch defaultChecked>Уведомления в Telegram</Switch>;

export const States = () => (
  <div className="flex flex-col items-start gap-4">
    <Switch>Напоминание за час до эфира</Switch>
    <Switch defaultChecked>Напоминание за день до эфира</Switch>
    <Switch disabled>SMS-уведомления недоступны</Switch>
  </div>
);

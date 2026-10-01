import { Alert } from '@ds/design-system';

export const Info = () => (
  <div style={{ width: 480 }}>
    <Alert variant="info">
      <b>Инфо.</b> Эфир начнётся через 15 минут — мы пришлём напоминание.
    </Alert>
  </div>
);

export const Variants = () => (
  <div className="flex flex-col gap-3" style={{ width: 480 }}>
    <Alert variant="info">
      <b>Инфо.</b> Эфир начнётся через 15 минут — мы пришлём напоминание.
    </Alert>
    <Alert variant="success">
      <b>Успех.</b> Вы записаны на эфир — добавили в календарь.
    </Alert>
    <Alert variant="warn">
      <b>Внимание.</b> Запись эфира будет доступна только 30 дней.
    </Alert>
    <Alert variant="danger">
      <b>Ошибка.</b> Не удалось подключиться к эфиру — обновите страницу.
    </Alert>
  </div>
);

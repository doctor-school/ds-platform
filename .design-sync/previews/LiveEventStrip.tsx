import { LiveEventStrip } from '@ds/design-system';

export const RegisteredDoctor = () => (
  <div className="w-full">
    <LiveEventStrip
      liveLabel="Идёт сейчас"
      title="Эфир «Вопросы по PRP»"
      titleHref="#event"
      meta="412 в комнате · Школа ортобиологии · до 20:30 МСК"
      actionLabel="Войти в комнату эфира"
      actionHref="#room"
    />
  </div>
);

export const GuestNotRegistered = () => (
  <div className="w-full">
    <LiveEventStrip
      liveLabel="Идёт сейчас"
      title="Эфир «Вопросы по PRP»"
      titleHref="#event"
      meta="412 в комнате · Школа ортобиологии · до 20:30 МСК"
      actionLabel="Открыть страницу события"
      actionHref="#event"
    />
  </div>
);

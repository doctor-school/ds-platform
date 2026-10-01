import { Button, WebinarStatusCard } from '@ds/design-system';

export const Upcoming = () => (
  <div style={{ width: 720 }}>
    <WebinarStatusCard
      timeLabel="Начало"
      time="19:00"
      timeSub="16 июля · МСК · 90 мин"
      head="Регистрация открыта"
      sub="Пришлём ссылку на почту и напомним за час до старта."
    >
      <Button asChild size="lg">
        <a href="#">Участвовать</a>
      </Button>
    </WebinarStatusCard>
  </div>
);

export const Live = () => (
  <div style={{ width: 720 }}>
    <WebinarStatusCard
      live
      liveLabel="В эфире"
      timeLabel="Сейчас"
      time="19:00"
      timeSub="16 июля · МСК · идёт"
      head="Эфир уже идёт"
      sub="Нужна регистрация врача — почта и специальность, две минуты."
    >
      <Button asChild size="lg">
        <a href="#">Участвовать</a>
      </Button>
    </WebinarStatusCard>
  </div>
);

export const Ended = () => (
  <div style={{ width: 720 }}>
    <WebinarStatusCard
      timeLabel="Прошёл"
      time="19:00"
      timeSub="16 июля · МСК"
      head="Эфир завершён"
      sub="Этот эфир уже прошёл. Регистрация закрыта."
    />
  </div>
);

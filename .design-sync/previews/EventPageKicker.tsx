import { EventPageHero, EventPageKicker } from '@ds/design-system';

export const LinkedSchool = () => (
  <div style={{ width: 720 }}>
    <EventPageHero
      kicker={<EventPageKicker school="Школа ортобиологии" schoolHref="#school" formatLabel="Вебинар · Онлайн" />}
      title="PRP при гонартрозе"
      dateLine="28 августа, 19:00 (МСК) · 90 минут"
    />
  </div>
);

export const PlainSchool = () => (
  <div style={{ width: 720 }}>
    <EventPageHero
      kicker={<EventPageKicker school="Школа кардиологии" formatLabel="Конгресс · Офлайн" />}
      title="Фибрилляция предсердий в практике терапевта"
      dateLine="12 сентября, 10:00 (МСК) · 2 дня"
    />
  </div>
);

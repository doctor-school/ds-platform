import { Badge, EventPageHero, EventPageKicker, Link } from '@ds/design-system';

const breadcrumb = (
  <>
    <Link href="#doctor-school" tone="on-primary">
      Doctor.School
    </Link>
    <span aria-hidden="true">/</span>
    <Link href="#specialty" tone="on-primary">
      Травматология и ортопедия
    </Link>
    <span aria-hidden="true">/</span>
    <span>Вебинар «PRP при гонартрозе»</span>
  </>
);

export const UpcomingWebinar = () => (
  <div className="w-full">
    <EventPageHero
      breadcrumb={breadcrumb}
      kicker={<EventPageKicker school="Школа ортобиологии" schoolHref="#school" formatLabel="Вебинар · Онлайн" />}
      title="PRP при гонартрозе"
      dateLine="28 августа, 19:00 (МСК) · 90 минут"
      chips={['Травматология и ортопедия', 'Ортобиология', 'НМО 2 балла']}
      statusPlate={<Badge variant="success">Скоро · через 5 дней</Badge>}
    />
  </div>
);

export const LiveNow = () => (
  <div className="w-full">
    <EventPageHero
      kicker={<EventPageKicker school="Школа ревматологии" formatLabel="Разбор случая · Онлайн" />}
      title="Спондилоартрит: два сложных случая"
      dateLine="16 июля, 19:00 (МСК) · 60 минут"
      chips={['Ревматология', 'НМО 1 балл']}
      statusPlate={<Badge variant="live">В эфире</Badge>}
    />
  </div>
);

import {
  Badge,
  EventAboutSection,
  EventFormatBlock,
  EventPageHero,
  EventPageKicker,
  EventPageShell,
  EventProgrammeSection,
  EventSignupCard,
  EventSpeakerCard,
  Link,
} from '@ds/design-system';

const conditions = [
  { label: 'Участие', value: '120 Pul' },
  { label: 'Формат', value: 'Онлайн · комната эфира' },
  { label: 'Длительность', value: <span className="tabular-nums">90 минут</span> },
  { label: 'НМО', value: <Badge variant="label">2 балла</Badge> },
];

const hero = (
  <EventPageHero
    breadcrumb={
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
    }
    kicker={<EventPageKicker school="Школа ортобиологии" schoolHref="#school" formatLabel="Вебинар · Онлайн" />}
    title="PRP при гонартрозе"
    dateLine="28 августа, 19:00 (МСК) · 90 минут"
    chips={['Травматология и ортопедия', 'Ортобиология', 'НМО 2 балла']}
    statusPlate={<Badge variant="success">Скоро · через 5 дней</Badge>}
  />
);

const flow = (
  <>
    <EventAboutSection
      heading="О чём событие"
      description="PRP-терапия при гонартрозе: показания, доказательная база и рабочие протоколы. Разбираем реальный клинический случай — от отбора пациента до оценки результата через 6 месяцев."
    />
    <EventProgrammeSection
      heading="Программа"
      downloadLabel="Скачать программу (PDF)"
      statement="Программу опубликуем ближе к дате события."
    />
    <EventSpeakerCard
      className="mt-18"
      name="Михаил Страхов"
      roleKicker="Травматолог-ортопед"
      affiliation="РНИМУ им. Пирогова"
      bio="Д.м.н., профессор кафедры травматологии и ортопедии, ведёт направление ортобиологии на платформе. Автор 40+ публикаций по регенеративным методикам."
      initials="МС"
      href="#expert"
      footerLabel="12 эфиров · страница эксперта →"
      footerHref="#expert"
    />
    <EventFormatBlock
      className="mt-18"
      kind="online"
      roomOpensLine="Комната эфира откроется за 10 минут до начала"
      duringLine="Во время эфира: вопрос лектору · опросы с живым графиком · отметки присутствия для НМО (90 минут и 2 отметки)"
    />
  </>
);

export const UpcomingRegister = () => (
  <div className="w-full">
    <EventPageShell
      hero={hero}
      aside={
        <EventSignupCard
          timeLabel="19:00"
          dateLabel="28 августа"
          weekdayLabel="пятница · МСК"
          conditions={conditions}
          cta={{ action: 'register', label: 'Участвовать', href: '#register', reason: null, presenceCount: null }}
          note="Нужна регистрация — вернём вас на эту страницу."
        />
      }
    >
      {flow}
    </EventPageShell>
  </div>
);

export const RegisteredDoctor = () => (
  <div className="w-full">
    <EventPageShell
      hero={hero}
      aside={
        <EventSignupCard
          timeLabel="19:00"
          dateLabel="28 августа"
          weekdayLabel="пятница · МСК"
          conditions={conditions}
          cta={{ action: 'registered', label: 'Вы записаны — напомним за час', href: null, reason: null, presenceCount: null }}
          proof={<span>Уже записались 37 ортопедов</span>}
        />
      }
    >
      {flow}
    </EventPageShell>
  </div>
);

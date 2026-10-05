import { EventList } from '@ds/design-system';

const labels = {
  upcoming: 'Будущие',
  past: 'Прошедшие',
  emptyTitle: 'Событий пока нет',
  emptyDescription: 'Новые эфиры появятся здесь после публикации.',
  pagination: 'Страницы событий',
  previous: 'Назад',
  next: 'Вперёд',
  page: (page: number) => `Страница ${page}`,
};

const af = {
  id: 'af',
  groupKey: '2026-07-18',
  groupLabel: '18 июля, пятница',
  href: '#',
  time: '18:00',
  tzLabel: 'МСК',
  dateLabel: '18 июля · пт',
  school: 'Школа кардиологии',
  title: 'Фибрилляция предсердий в практике терапевта',
  specialties: ['Кардиология', 'Терапия'],
  speakers: [{ name: 'Марина Волкова', org: 'Кардиолог, к.м.н.' }],
};

const upcoming = [
  {
    id: 'achilles',
    groupKey: '2026-07-16',
    groupLabel: '16 июля, среда',
    href: '#',
    time: '19:00',
    tzLabel: 'МСК',
    dateLabel: '16 июля · ср',
    school: 'Школа травматологии и ортопедии',
    title: 'Пластика ахиллова сухожилия: разбор клинических случаев',
    specialties: ['Травматология', 'Ортопедия'],
    speakers: [{ name: 'Анна Соколова', org: 'Травматолог-ортопед, к.м.н.' }],
  },
  {
    id: 'prp',
    groupKey: '2026-07-17',
    groupLabel: '17 июля, четверг',
    href: '#',
    time: '20:30',
    tzLabel: 'МСК',
    dateLabel: '17 июля · чт',
    school: 'Школа ортобиологии',
    title: 'PRP при гонартрозе: показания и протоколы',
    specialties: ['Ортобиология'],
    speakers: [{ name: 'Михаил Страхов', org: 'Д.м.н., профессор' }],
  },
  af,
];

export const UpcomingGroupedByDay = () => (
  <div className="w-full">
    <EventList
      items={upcoming.slice(0, 2).map(({ specialties: _specialties, ...item }) => item)}
      selectedTab="upcoming"
      counts={{ upcoming: 3, past: 12 }}
      labels={labels}
      paginationMode="none"
    />
  </div>
);

export const WithPager = () => (
  <div className="w-full">
    <EventList
      items={upcoming.slice(2)}
      selectedTab="upcoming"
      counts={{ upcoming: 31, past: 12 }}
      labels={labels}
      page={2}
      pageCount={4}
    />
  </div>
);

export const PastRecordings = () => (
  <div className="w-full">
    <EventList
      items={[
        {
          ...af,
          groupKey: '2026-06',
          groupLabel: 'Июнь 2026',
          dateLabel: '12 июня · чт',
          variant: 'past',
          recordingLabel: 'Запись доступна',
          ctaHref: '#',
          ctaLabel: 'Смотреть запись',
        },
      ]}
      selectedTab="past"
      counts={{ upcoming: 3, past: 1 }}
      labels={labels}
      paginationMode="none"
    />
  </div>
);

export const Empty = () => (
  <div className="w-full">
    <EventList
      items={[]}
      selectedTab="upcoming"
      counts={{ upcoming: 0, past: 0 }}
      labels={labels}
      paginationMode="none"
    />
  </div>
);

// Sticky day/month group plates (019 EARS-1): the host passes its sticky
// header's height as `stickyHeaderOffset` so a plate sticks right under it.
// Stickiness is scroll-only; the static cell shows every plate in place.
const stickyItems = (tense: 'upcoming' | 'past') => {
  const groups =
    tense === 'past'
      ? [
          { key: '2026-06', label: 'Июнь 2026', date: '18 июня · чт' },
          { key: '2026-05', label: 'Май 2026', date: '14 мая · чт' },
        ]
      : [
          { key: '2026-07-16', label: '16 июля, среда', date: '16 июля · ср' },
          { key: '2026-07-17', label: '17 июля, четверг', date: '17 июля · чт' },
        ];
  return groups.flatMap((group) =>
    [0, 1].map((index) => ({
      ...af,
      id: `${tense}-${group.key}-${index}`,
      groupKey: group.key,
      groupLabel: group.label,
      dateLabel: group.date,
      ...(tense === 'past'
        ? { variant: 'past' as const, recordingLabel: 'Есть запись', ctaHref: '#', ctaLabel: 'Смотреть запись' }
        : {}),
    })),
  );
};

const StickyPlates = ({ tense }: { tense: 'upcoming' | 'past' }) => (
  <div className="w-full bg-background">
    <div className="sticky top-0 z-20 flex h-16 items-center bg-header px-4 text-sm font-bold text-header-foreground">
      Doctor.School
    </div>
    <div className="px-4 pb-8">
      <EventList
        items={stickyItems(tense)}
        selectedTab={tense}
        tenseControl="none"
        paginationMode="none"
        labels={labels}
        stickyHeaderOffset="calc(var(--spacing) * 16)"
      />
    </div>
  </div>
);

export const StickyDayPlates = () => <StickyPlates tense="upcoming" />;

export const StickyMonthPlates = () => <StickyPlates tense="past" />;

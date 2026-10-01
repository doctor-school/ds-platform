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
  {
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
  },
];

export const UpcomingGroupedByDay = () => (
  <div className="w-full">
    <EventList
      items={upcoming.slice(0, 2).map((item) => ({ ...item, specialties: undefined }))}
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
          ...upcoming[2],
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

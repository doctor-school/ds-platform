import { WebinarCard } from '@ds/design-system';

const base = {
  href: '#',
  time: '19:00',
  tzLabel: 'МСК',
  dateLabel: '16 июля · ср',
  school: 'Школа травматологии и ортопедии',
  title: 'Пластика ахиллова сухожилия: разбор клинических случаев',
  specialties: ['Травматология', 'Ортопедия'],
  speakers: [
    { name: 'Анна Соколова', org: 'Травматолог-ортопед, к.м.н.' },
    { name: 'Михаил Верещагин', org: 'Хирург, профессор' },
  ],
};

export const Scheduled = () => (
  <div className="w-full">
    <WebinarCard {...base} />
  </div>
);

export const LiveWithRoomEntry = () => (
  <div className="w-full">
    <WebinarCard
      {...base}
      live
      liveLabel="В эфире"
      ctaHref="#room"
      ctaLabel="Войти в эфир"
    />
  </div>
);

export const DoctorFeed = () => (
  <div className="w-full">
    <WebinarCard
      {...base}
      specialties={undefined}
      speakers={[{ name: 'Анна Соколова', org: 'К.м.н.' }]}
      formatLabel="Вебинар"
      venueLabel="Онлайн"
      nmoLabel="НМО · 2 ЗЕТ"
      pulCost={120}
      pulCostLabel="120 Pul"
      signUpCount={128}
      signUpLabel="коллег записались"
      registered
      registeredLabel="Вы записаны"
    />
  </div>
);

export const OfflineSoldOut = () => (
  <div className="w-full">
    <WebinarCard
      {...base}
      specialties={undefined}
      title="Школа артроскопии коленного сустава: практический курс"
      formatLabel="Конгресс"
      dateLabel="16–18 июля"
      venueLabel="Офлайн"
      city="Казань"
      nmoLabel="НМО · 6 ЗЕТ"
      signUpCount={240}
      signUpLabel="коллег записались"
      seatsLeft={0}
      seatsLeftLabel="мест осталось"
      soldOutLabel="мест не осталось"
    />
  </div>
);

export const Past = () => (
  <div className="w-full">
    <WebinarCard
      {...base}
      variant="past"
      recordingLabel="Запись доступна"
      ctaHref="#"
      ctaLabel="Смотреть запись"
    />
  </div>
);

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

const { specialties: _specialties, ...feedBase } = base;

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
      {...feedBase}
      speakers={[{ name: 'Анна Соколова', org: 'К.м.н.' }]}
      formatLabel="Вебинар"
      venueLabel="Онлайн"
      nmoLabel="НМО · 2 ЗЕТ"
      pulCost={120}
      pulCostLabel="120 Pul"
      signUpCount={128}
      signUpLabel="Коллег записались"
      registered
      registeredLabel="Вы записаны"
    />
  </div>
);

export const OfflineSoldOut = () => (
  <div className="w-full">
    <WebinarCard
      {...feedBase}
      title="Школа артроскопии коленного сустава: практический курс"
      formatLabel="Конгресс"
      dateLabel="16–18 июля"
      venueLabel="Офлайн"
      city="Казань"
      nmoLabel="НМО · 6 ЗЕТ"
      signUpCount={240}
      signUpLabel="Коллег записались"
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

// 019 EARS-2 / 004 EARS-12: kind and format are separate props, joined by the
// card («Мастер-класс · гибрид»); a hybrid card adds its venue-local start line;
// the recording line renders on a past card only.
const kindFormat = {
  ...feedBase,
  speakers: [{ name: 'Анна Соколова', org: 'К.м.н.' }],
  nmoLabel: 'НМО · 2 ЗЕТ',
  signUpLabel: 'Коллег записались',
  seatsLeftLabel: 'мест осталось',
  soldOutLabel: 'мест не осталось',
};

export const KindAndFormatOnline = () => (
  <div className="w-full">
    <WebinarCard
      {...kindFormat}
      kindLabel="Вебинар"
      formatLabel="онлайн"
      venueLabel="Онлайн"
      pulCost={120}
      pulCostLabel="120 Pul"
      signUpCount={128}
    />
  </div>
);

export const HybridUpcomingVenueTime = () => (
  <div className="w-full">
    <WebinarCard
      {...kindFormat}
      title="Мастер-класс: артроскопия плечевого сустава"
      time="12:00"
      tzLabel="GMT+3"
      dateLabel="14 ноября · пт"
      kindLabel="Мастер-класс"
      formatLabel="гибрид"
      venueTimeLabel="На площадке 16:00 GMT+7"
      venueLabel="Гибрид"
      city="Новосибирск"
      signUpCount={56}
      seatsLeft={14}
    />
  </div>
);

export const HybridPastVenueAndRecording = () => (
  <div className="w-full">
    <WebinarCard
      {...kindFormat}
      variant="past"
      title="Мастер-класс: артроскопия плечевого сустава"
      time="12:00"
      tzLabel="GMT+3"
      dateLabel="14 мая · ср"
      kindLabel="Мастер-класс"
      formatLabel="гибрид"
      venueTimeLabel="На площадке 16:00 GMT+7"
      recordingLabel="Есть запись"
      venueLabel="Гибрид"
      city="Новосибирск"
    />
  </div>
);

export const OfflineCongressKindAndFormat = () => (
  <div className="w-full">
    <WebinarCard
      {...kindFormat}
      title="Конгресс «Ортобиология-2026»"
      time="10:00"
      dateLabel="14–15 ноября"
      kindLabel="Конгресс"
      formatLabel="офлайн"
      venueLabel="Офлайн"
      city="Москва"
      pulCost={450}
      pulCostLabel="450 Pul"
      signUpCount={314}
      seatsLeft={40}
    />
  </div>
);

export const LongKindWrapsInPlate = () => (
  <div className="w-full">
    <WebinarCard
      {...kindFormat}
      title="Встреча клуба: травматология и спортивная медицина"
      time="18:30"
      dateLabel="3 декабря · ср"
      kindLabel="Межрегиональная научно-практическая встреча клуба"
      formatLabel="офлайн"
      venueLabel="Офлайн"
      city="Казань"
      signUpCount={18}
      seatsLeft={12}
    />
  </div>
);

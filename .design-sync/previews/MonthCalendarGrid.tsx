import { MonthCalendarGrid } from '@ds/design-system';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const WEEKS = [
  [
    { dateLabel: '30', muted: true, mutedDate: true },
    { dateLabel: '1', note: '2 эфира · прошли' },
    { dateLabel: '2', note: '1 эфир · прошёл' },
    { dateLabel: '3' },
    {
      dateLabel: '4',
      pills: [{ href: '#', time: '18:00', title: 'Разбор клинического случая' }],
    },
    { dateLabel: '5', muted: true, mutedDate: true },
    { dateLabel: '6', muted: true, mutedDate: true },
  ],
  [
    {
      dateLabel: '7 · сегодня',
      today: true,
      pills: [
        { href: '#', time: '19:00', title: 'Прямой эфир', live: true },
        { href: '#', time: '20:30', title: 'Новое в терапии' },
      ],
    },
    { dateLabel: '8', pills: [{ href: '#', time: '18:00', title: 'Кардиология' }] },
    { dateLabel: '9' },
    { dateLabel: '10' },
    { dateLabel: '11', pills: [{ href: '#', time: '19:30', title: 'Педиатрия' }] },
    { dateLabel: '12', muted: true, mutedDate: true },
    { dateLabel: '13', muted: true, mutedDate: true },
  ],
];

const LEGEND = { live: 'В эфире', planned: 'Запланирован', past: 'Прошёл / пусто' };

export const TwoWeeks = () => (
  <MonthCalendarGrid weekdays={WEEKDAYS} weeks={WEEKS} liveLabel="В эфире" legend={LEGEND} />
);

export const WithMonthLinks = () => (
  <MonthCalendarGrid
    weekdays={WEEKDAYS}
    weeks={WEEKS.slice(1)}
    liveLabel="В эфире"
    legend={LEGEND}
    prevMonthLink={{ href: '#', label: '← Июнь' }}
    nextMonthLink={{ href: '#', label: 'Август →' }}
  />
);

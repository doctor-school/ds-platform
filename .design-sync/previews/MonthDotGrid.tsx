import { MonthDotGrid } from '@ds/design-system';
import type { DotGridCell } from '@ds/design-system';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const WEEKS: DotGridCell[][] = [
  [
    { day: 30, inMonth: false, dots: [], ariaLabel: '30' },
    { day: 1, inMonth: true, dots: ['past', 'past'], ariaLabel: '1 — 2 эфира прошли' },
    { day: 2, inMonth: true, dots: ['past'], ariaLabel: '2 — 1 эфир прошёл' },
    { day: 3, inMonth: true, dots: [], ariaLabel: '3 — нет эфиров' },
    { day: 4, inMonth: true, dots: ['event'], ariaLabel: '4 — 1 эфир' },
    { day: 5, inMonth: true, dots: [], ariaLabel: '5 — нет эфиров' },
    { day: 6, inMonth: true, dots: [], ariaLabel: '6 — нет эфиров' },
  ],
  [
    {
      day: 7,
      inMonth: true,
      today: true,
      dots: ['live', 'event'],
      ariaLabel: '7 июля, 2 эфира, идёт эфир',
    },
    { day: 8, inMonth: true, dots: ['event'], ariaLabel: '8 — 1 эфир' },
    { day: 9, inMonth: true, dots: [], ariaLabel: '9 — нет эфиров' },
    { day: 10, inMonth: true, dots: [], ariaLabel: '10 — нет эфиров' },
    { day: 11, inMonth: true, dots: ['event', 'event', 'event'], ariaLabel: '11 — 3 эфира' },
    { day: 12, inMonth: true, dots: [], ariaLabel: '12 — нет эфиров' },
    { day: 13, inMonth: true, dots: [], ariaLabel: '13 — нет эфиров' },
  ],
];

export const TodaySelected = () => (
  <div style={{ width: 360 }}>
    <MonthDotGrid weekdays={WEEKDAYS} weeks={WEEKS} selectedDay={7} onSelectDay={() => {}} />
  </div>
);

export const OtherDaySelected = () => (
  <div style={{ width: 360 }}>
    <MonthDotGrid weekdays={WEEKDAYS} weeks={WEEKS} selectedDay={11} onSelectDay={() => {}} />
  </div>
);

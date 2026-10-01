import { MonthPicker } from '@ds/design-system';

const MONTHS = [
  { label: 'Янв', note: 'прошёл', href: '#', muted: true },
  { label: 'Февр', note: 'прошёл', href: '#', muted: true },
  { label: 'Март', note: 'прошёл', href: '#', muted: true },
  { label: 'Апр', note: 'прошёл', href: '#', muted: true },
  { label: 'Май', note: 'прошёл', href: '#', muted: true },
  { label: 'Июнь', note: 'прошёл', href: '#', muted: true },
  { label: 'Июль', note: '142 эфира', current: true },
  { label: 'Авг', note: '118 эфиров', href: '#' },
  { label: 'Сент', note: '156 эфиров', href: '#' },
  { label: 'Окт', note: '149 эфиров', href: '#' },
  { label: 'Нояб', note: '131 эфир', href: '#' },
  { label: 'Дек', note: '87 эфиров', href: '#' },
];

const props = {
  triggerLabel: 'Июль 2026',
  pickerLabel: 'Выбрать месяц',
  initialYear: '2026',
  years: [{ year: '2026', months: MONTHS }],
  prevYearHref: '#',
  nextYearHref: '#',
  prevYearLabel: 'Предыдущий год',
  nextYearLabel: 'Следующий год',
};

export const Open = () => (
  <div style={{ paddingBottom: 420 }}>
    <MonthPicker {...props} defaultOpen />
  </div>
);

export const Closed = () => <MonthPicker {...props} />;

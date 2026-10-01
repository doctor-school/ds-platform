import { EventsFilter } from '@ds/design-system';

const options = {
  view: [
    { id: 'week', label: 'Неделя' },
    { id: 'month', label: 'Месяц' },
  ],
  tense: [
    { id: 'upcoming', label: 'Будущие' },
    { id: 'past', label: 'Прошедшие' },
  ],
  format: [
    { id: 'webinar', label: 'Вебинар' },
    { id: 'online-meeting', label: 'Онлайн-встреча' },
    { id: 'offline-meetup', label: 'Офлайн-встреча коллег' },
    { id: 'congress', label: 'Конгресс' },
    { id: 'podcast', label: 'Подкаст-эфир' },
  ],
  kind: [
    { id: 'case-review', label: 'Разбор случая' },
    { id: 'club', label: 'Doctor Club' },
    { id: 'lecture', label: 'Лекция' },
  ],
  specialty: [
    { id: 'traumatology', label: 'Травматология' },
    { id: 'rheumatology', label: 'Ревматология' },
  ],
  city: [
    { id: 'kazan', label: 'Казань' },
    { id: 'moscow', label: 'Москва' },
    { id: 'spb', label: 'Санкт-Петербург' },
  ],
};

// The «цена в Pul» facet labels are deliberately omitted (the facet then does not render).
const labels = {
  panel: 'Фильтры событий',
  view: 'Вид',
  tense: 'Время',
  format: 'Формат',
  kind: 'Тип события',
  specialty: 'Специальность',
  specialtyMine: 'Моя и смежные',
  specialtyAll: 'Все специальности',
  city: 'Город',
  cityHint: 'Город действует на офлайн- и гибридные события.',
  anyValue: 'Все',
  cityAny: 'Все города',
  nmoOnly: 'Только с НМО',
  nmoFacet: 'НМО',
  nmoOff: 'Не важно',
  closeOptions: 'Закрыть список значений',
  query: 'Поиск по названию',
  queryPlaceholder: 'Поиск по названию',
  applied: 'Фильтры:',
  appliedCount: (n: number) => `Применено фильтров: ${n}`,
  removeFacet: 'Убрать фильтр',
  reset: 'Сбросить фильтры',
};

const empty = {
  format: [],
  kind: [],
  specialtyScope: 'mine-and-adjacent' as const,
  city: [],
  nmoOnly: false,
  freeByPul: false,
  query: '',
};

const noop = () => {};
const common = {
  options,
  labels,
  onChange: noop,
  onReset: noop,
  view: { value: 'week', onChange: noop },
  tense: { value: 'upcoming', onChange: noop },
};

export const Wave1 = () => (
  <div style={{ width: 384 }}>
    <EventsFilter {...common} fill="wave-1" applied={empty} appliedCount={0} />
  </div>
);

export const Intermediate = () => (
  <div style={{ width: 384 }}>
    <EventsFilter {...common} fill="intermediate" applied={empty} appliedCount={0} />
  </div>
);

export const Full = () => (
  <div style={{ width: 384 }}>
    <EventsFilter {...common} fill="full" applied={empty} appliedCount={0} />
  </div>
);

export const IntermediateWithApplied = () => (
  <div style={{ width: 384 }}>
    <EventsFilter
      {...common}
      fill="intermediate"
      applied={{ ...empty, format: ['webinar', 'offline-meetup'], kind: ['club'] }}
      appliedCount={3}
    />
  </div>
);

export const FullWithApplied = () => (
  <div style={{ width: 384 }}>
    <EventsFilter
      {...common}
      options={{ ...options, view: undefined, tense: undefined }}
      fill="full"
      applied={{ ...empty, specialtyScope: 'all', city: ['kazan'], nmoOnly: true, query: 'PRP' }}
      appliedCount={4}
    />
  </div>
);

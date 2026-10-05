import { EventsFilter, defaultAppliedFacets } from '@ds/design-system';
import type { AppliedFacets, EventsFilterHost, EventsFilterLabels, EventsFilterOptions } from '@ds/design-system';

// Mirrors apps/showcase/app/primitives/primitives-view.tsx «Events-filter»:
// the host picks the facet set (doctor · Академия); the panel itself is the same.
const opts = (pairs: ReadonlyArray<readonly [string, string]>) => pairs.map(([id, label]) => ({ id, label }));

const doctorOptions: EventsFilterOptions = {
  format: opts([
    ['online', 'Онлайн'],
    ['offline', 'Офлайн'],
    ['hybrid', 'Гибрид'],
  ]),
  kind: opts([
    ['webinar', 'Вебинар'],
    ['efir', 'Эфир'],
    ['congress', 'Конгресс'],
    ['club', 'Встреча клуба'],
    ['master', 'Мастер-класс'],
    ['case', 'Клинический разбор с пациентом'],
  ]),
  specialty: opts([
    ['endo', 'Эндокринология'],
    ['rad', 'Лучевая диагностика'],
    ['rehab', 'Реабилитация'],
    ['rheum', 'Ревматология'],
    ['sport', 'Спортивная медицина'],
    ['ortho', 'Травматология и ортопедия'],
  ]),
  city: opts([
    ['c0', 'Москва'],
    ['c1', 'Казань'],
    ['c2', 'Новосибирск'],
    ['c3', 'Екатеринбург'],
    ['c4', 'Санкт-Петербург'],
  ]),
  direction: opts([
    ['orthobio', 'Ортобиология'],
    ['arthro', 'Артроскопия'],
    ['sportmed', 'Спортивная медицина'],
    ['rehab', 'Реабилитация'],
  ]),
};

const academyOptions: EventsFilterOptions = {
  project: opts([
    ['as', 'Академия смыслов'],
    ['sp', 'Школа продюсеров'],
    ['p1', 'Школа ортобиологии'],
    ['p2', 'Школа артроскопии'],
  ]),
  expert: opts([
    ['belov', 'Артём Белов'],
    ['vorontsova', 'Елена Воронцова'],
    ['gromova', 'Ирина Громова'],
  ]),
  topic: opts([
    ['partner', 'Партнёрства'],
    ['program', 'Программа школ'],
    ['production', 'Продакшн эфиров'],
    ['metrics', 'Метрики и отчётность'],
    ['regul', 'Регуляторика'],
  ]),
};

const shared = {
  panel: 'Фильтры',
  title: 'Фильтры',
  appliedCount: (n: number) => `Применено: ${n}`,
  reset: 'Сбросить',
  removeFacet: 'Убрать',
  combobox: {
    emptyLabel: 'Ничего не найдено',
    searchLabel: 'Найти',
    countLabel: (shown: number, total: number) => `Найдено ${shown} из ${total}`,
    loadMoreLabel: 'Показать ещё',
    loadingMoreLabel: 'Загружаем…',
    loadMoreErrorLabel: 'Повторить',
  },
};

const labels: Record<EventsFilterHost, EventsFilterLabels> = {
  doctor: {
    ...shared,
    query: { label: 'Поиск по названию', placeholder: 'Например, PRP' },
    specialty: {
      label: 'Специальность',
      mine: 'Моя и смежные',
      all: 'Все специальности',
      placeholder: 'Выбрать специальность',
      addPlaceholder: 'Добавить специальность',
      searchPlaceholder: 'Например, кардиология',
    },
    format: 'Формат',
    kind: 'Вид события',
    city: {
      label: 'Город',
      hint: 'Только для офлайн-событий',
      placeholder: 'Любой город',
      addPlaceholder: 'Добавить город',
      searchPlaceholder: 'Начните вводить город',
    },
    direction: {
      label: 'Направление',
      placeholder: 'Любое направление',
      addPlaceholder: 'Добавить направление',
      searchPlaceholder: 'Например, артроскопия',
    },
    nmoOnly: 'Только с НМО',
  },
  academy: {
    ...shared,
    project: {
      label: 'Проект',
      placeholder: 'Все проекты',
      addPlaceholder: 'Добавить проект',
      searchPlaceholder: 'Например, школа продюсеров',
    },
    expert: {
      label: 'Эксперт',
      placeholder: 'Все эксперты',
      addPlaceholder: 'Добавить эксперта',
      searchPlaceholder: 'Фамилия или имя',
    },
    topic: {
      label: 'Тема',
      placeholder: 'Все темы',
      addPlaceholder: 'Добавить тему',
      searchPlaceholder: 'Например, метрики',
    },
  },
};

const noop = () => {};

const Panel = ({
  host,
  applied = {},
  showHeader = true,
}: {
  host: EventsFilterHost;
  applied?: Partial<AppliedFacets>;
  showHeader?: boolean;
}) => (
  <div style={{ width: 384 }}>
    <EventsFilter
      host={host}
      applied={{ ...defaultAppliedFacets(), ...applied }}
      options={host === 'doctor' ? doctorOptions : academyOptions}
      labels={labels[host]}
      onChange={noop}
      onReset={noop}
      showHeader={showHeader}
    />
  </div>
);

export const Doctor = () => <Panel host="doctor" />;

export const DoctorWithApplied = () => (
  <Panel
    host="doctor"
    applied={{
      query: 'PRP',
      specialtyScope: [
        { id: 'sport', label: 'Спортивная медицина' },
        { id: 'rheum', label: 'Ревматология' },
      ],
      format: ['offline', 'hybrid'],
      kind: ['club'],
      city: ['c1'],
      direction: ['arthro'],
      nmoOnly: true,
    }}
  />
);

export const Academy = () => <Panel host="academy" />;

export const AcademyWithApplied = () => (
  <Panel host="academy" applied={{ project: ['as'], expert: ['belov'], topic: ['metrics', 'regul'] }} />
);

export const SheetBodyWithoutHeader = () => (
  <Panel host="doctor" showHeader={false} applied={{ specialtyScope: 'all', kind: ['webinar'], nmoOnly: true }} />
);

import type { ReactNode } from 'react';
import { Alert, Badge, Button, DataTable } from '@ds/design-system';

const Wide = ({ children }: { children: ReactNode }) => <div style={{ width: '100%' }}>{children}</div>;

type DirectionRow = {
  id: string;
  title: string;
  parent: string;
  code: string;
  specialties: number;
  status: 'published' | 'draft';
};

const ROWS: DirectionRow[] = [
  {
    id: 'lab',
    title: 'Клиническая лабораторная диагностика и лабораторная генетика',
    parent: 'Диагностика',
    code: '31.08.05 — клиническая лабораторная диагностика',
    specialties: 14,
    status: 'published',
  },
  {
    id: 'cvs',
    title: 'Сердечно-сосудистая хирургия',
    parent: 'Хирургия',
    code: '31.08.63 — сердечно-сосудистая хирургия',
    specialties: 9,
    status: 'published',
  },
  {
    id: 'func',
    title: 'Функциональная диагностика',
    parent: 'Диагностика',
    code: '31.08.12 — функциональная диагностика',
    specialties: 6,
    status: 'draft',
  },
  {
    id: 'obgyn',
    title: 'Акушерство и гинекология',
    parent: 'Женское здоровье',
    code: '31.08.01 — акушерство и гинекология',
    specialties: 21,
    status: 'published',
  },
];

const RECORD = {
  header: 'Направление',
  width: '48%',
  title: (row: DirectionRow) => row.title,
  context: (row: DirectionRow) => row.parent,
  label: (row: DirectionRow) => `Открыть направление «${row.title}»`,
};

const CHIP = {
  published: { label: 'Опубликовано', className: 'bg-success-tint text-success-text' },
  draft: { label: 'Черновик', className: 'bg-warning-tint text-foreground' },
};

const COLUMNS = [
  {
    key: 'code',
    header: 'Код номенклатуры',
    width: '30%',
    overflow: 'ellipsis' as const,
    render: (row: DirectionRow) => row.code,
    fullValue: (row: DirectionRow) => row.code,
  },
  {
    key: 'status',
    header: 'Статус',
    width: '22%',
    render: (row: DirectionRow) => (
      <Badge className={CHIP[row.status].className}>{CHIP[row.status].label}</Badge>
    ),
  },
];

const EMPTY_NO_RECORDS = {
  title: 'Направлений пока нет',
  description: 'Создайте первое направление — специальности привяжутся к нему.',
  action: <Button size="sm">Создать направление</Button>,
};

const EMPTY_NO_RESULTS = {
  title: 'Ничего не найдено',
  description: 'По запросу «кардио» и фильтру «Черновики» нет ни одной записи.',
  action: (
    <Button variant="outline" size="sm">
      Сбросить фильтры
    </Button>
  ),
};

const base = {
  caption: 'Направления',
  record: RECORD,
  columns: COLUMNS,
  getRowKey: (row: DirectionRow) => row.id,
  emptyNoRecords: EMPTY_NO_RECORDS,
  emptyNoResults: EMPTY_NO_RESULTS,
};

export const Populated = () => (
  <Wide>
    <DataTable
      {...base}
      rows={ROWS}
      rowHref={() => '#'}
      pagination={{
        page: 2,
        pageCount: 7,
        onPageChange: () => {},
        navLabel: 'Страницы',
        previousLabel: 'Назад',
        nextLabel: 'Вперёд',
        pageLabel: (n: number) => `Страница ${n}`,
        readout: 'Показаны 5–8 из 26',
      }}
    />
  </Wide>
);

export const WithActions = () => (
  <Wide>
    <DataTable
      {...base}
      rows={ROWS.slice(0, 2)}
      columns={[]}
      actionsHeader="Действия"
      actions={() => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm">
            Изменить
          </Button>
          <Button variant="outline" size="sm">
            Снять с публикации
          </Button>
        </div>
      )}
    />
  </Wide>
);

export const Loading = () => (
  <Wide>
    <DataTable {...base} rows={[]} isLoading loadingRowCount={3} />
  </Wide>
);

export const LoadError = () => (
  <Wide>
    <DataTable
      {...base}
      rows={[]}
      error={<Alert variant="danger">Не удалось загрузить направления. Обновите страницу.</Alert>}
    />
  </Wide>
);

export const NoResults = () => (
  <Wide>
    <DataTable {...base} rows={[]} isFiltered />
  </Wide>
);

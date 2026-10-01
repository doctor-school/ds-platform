import { FilterBar } from '@ds/design-system';

const noop = () => {};

export const InstantWithApplied = () => (
  <div className="w-full">
    <FilterBar
      applyMode="instant"
      label="Фильтры направлений"
      search={{
        value: '',
        onCommit: noop,
        label: 'Поиск по названию',
        placeholder: 'Например, кардиология',
      }}
      applied={[
        { id: 'draft', label: 'Черновики', onRemove: noop },
        { id: 'diagnostics', label: 'Диагностика', onRemove: noop },
      ]}
      appliedLabel="Выбрано:"
      removeFilterLabel="Убрать фильтр"
      onResetAll={noop}
      resetLabel="Сбросить всё"
      resultCount="Найдено 2 из 14"
      busyLabel="Идёт поиск"
    />
  </div>
);

export const NothingApplied = () => (
  <div className="w-full">
    <FilterBar
      applyMode="instant"
      label="Фильтры направлений"
      search={{
        value: '',
        onCommit: noop,
        label: 'Поиск по названию',
        placeholder: 'Например, кардиология',
      }}
      resetLabel="Сбросить всё"
      resultCount="Найдено 231 из 231"
    />
  </div>
);

export const Busy = () => (
  <div className="w-full">
    <FilterBar
      applyMode="instant"
      label="Фильтры направлений"
      search={{ value: 'кардио', onCommit: noop, label: 'Поиск по названию' }}
      resetLabel="Сбросить всё"
      isBusy
      busyLabel="Идёт поиск"
      resultCount="Найдено 12 из 231"
    />
  </div>
);

export const BatchSubmit = () => (
  <div className="w-full">
    <FilterBar
      applyMode="batch"
      label="Фильтры отчёта"
      search={{ value: '', onCommit: noop, label: 'Поиск по названию' }}
      resetLabel="Сбросить всё"
      submitLabel="Показать"
      onSubmit={noop}
    />
  </div>
);

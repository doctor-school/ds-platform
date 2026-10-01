import { FilterChip } from '@ds/design-system';

export const Rest = () => <FilterChip>Кардиология</FilterChip>;

export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <FilterChip>Кардиология</FilterChip>
    <FilterChip selected>Неврология</FilterChip>
    <FilterChip disabled>Эндокринология</FilterChip>
  </div>
);

export const FilterRow = () => (
  <div className="flex flex-wrap items-center gap-2" style={{ width: 480 }}>
    <FilterChip selected>Вебинар</FilterChip>
    <FilterChip>Онлайн-встреча</FilterChip>
    <FilterChip selected>Конгресс</FilterChip>
    <FilterChip>Подкаст-эфир</FilterChip>
    <FilterChip>Разбор случая</FilterChip>
  </div>
);

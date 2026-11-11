import { FilterBarTextField } from '@ds/design-system';

const noop = () => {};

export const Empty = () => (
  <div style={{ width: 320 }}>
    <FilterBarTextField
      label="Раздел"
      value=""
      onCommit={noop}
      placeholder="Содержит…"
      busyLabel="Идёт поиск…"
    />
  </div>
);

export const Filled = () => (
  <div style={{ width: 320 }}>
    <FilterBarTextField
      label="Раздел"
      value="Кардиология"
      onCommit={noop}
      placeholder="Содержит…"
      busyLabel="Идёт поиск…"
    />
  </div>
);

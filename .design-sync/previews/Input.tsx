import { Input } from '@ds/design-system';

export const Empty = () => (
  <div style={{ width: 320 }}>
    <Input aria-label="Email" placeholder="doctor@example.ru" />
  </div>
);

export const Filled = () => (
  <div style={{ width: 320 }}>
    <Input aria-label="Email" defaultValue="anna.smirnova@example.ru" />
  </div>
);

export const Invalid = () => (
  <div style={{ width: 320 }}>
    <Input aria-label="Email" defaultValue="anna@clinic" aria-invalid="true" />
  </div>
);

export const Success = () => (
  <div style={{ width: 320 }}>
    <Input aria-label="Email" defaultValue="anna.smirnova@example.ru" data-success="true" />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 320 }}>
    <Input aria-label="Email" defaultValue="anna.smirnova@example.ru" disabled />
  </div>
);

export const HeaderSearch = () => (
  <div className="bg-header p-4" style={{ width: 400 }}>
    <Input
      type="search"
      variant="header"
      className="w-full"
      aria-label="Поиск вебинаров"
      placeholder="Поиск вебинаров и курсов НМО"
    />
  </div>
);

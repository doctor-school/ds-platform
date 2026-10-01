import { Textarea } from '@ds/design-system';

const counter = (remaining: number) =>
  remaining < 0 ? `превышено на ${Math.abs(remaining)}` : `осталось ${remaining}`;

export const Empty = () => (
  <div style={{ width: 360 }}>
    <Textarea
      aria-label="Описание программы"
      placeholder="Кратко опишите программу вебинара"
      showCounter
      maxLength={120}
      formatCounter={counter}
    />
  </div>
);

export const Filled = () => (
  <div style={{ width: 360 }}>
    <Textarea
      aria-label="Описание программы"
      showCounter
      maxLength={120}
      formatCounter={counter}
      defaultValue="Программа для практикующих кардиологов: разбор клинических случаев фибрилляции предсердий."
    />
  </div>
);

export const OverLimit = () => (
  <div style={{ width: 360 }}>
    <Textarea
      aria-label="Описание программы"
      showCounter
      maxLength={120}
      formatCounter={counter}
      defaultValue="Слишком длинное описание программы, которое заведомо не проходит по границе поля и должно быть честно помечено как превышение лимита символов."
    />
  </div>
);

export const Invalid = () => (
  <div style={{ width: 360 }}>
    <Textarea aria-label="Описание программы" aria-invalid="true" defaultValue="" />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 360 }}>
    <Textarea
      aria-label="Описание программы"
      disabled
      defaultValue="Программа утверждена и опубликована — редактирование закрыто."
    />
  </div>
);

import { Radio } from '@ds/design-system';

export const Group = () => (
  <div role="radiogroup" aria-label="Формат участия" className="flex flex-col items-start gap-3">
    <Radio name="format" value="online" defaultChecked>
      Онлайн-трансляция
    </Radio>
    <Radio name="format" value="offline">
      Очно в конгресс-центре
    </Radio>
    <Radio name="format" value="record">
      Смотреть в записи
    </Radio>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
    <Radio name="state-off" value="off">
      Не выбрано
    </Radio>
    <Radio name="state-on" value="on" defaultChecked>
      Выбрано
    </Radio>
    <Radio name="state-disabled" value="d" disabled>
      Недоступно
    </Radio>
  </div>
);

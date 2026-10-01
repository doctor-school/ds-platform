import { Checkbox } from '@ds/design-system';

export const WithLabel = () => <Checkbox defaultChecked>Присылать напоминания об эфирах</Checkbox>;

export const States = () => (
  <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
    <Checkbox>Выключено</Checkbox>
    <Checkbox defaultChecked>Включено</Checkbox>
    <Checkbox disabled>Недоступно</Checkbox>
    <Checkbox disabled defaultChecked>
      Недоступно, включено
    </Checkbox>
  </div>
);

export const Invalid = () => (
  <div className="flex flex-col items-start gap-4">
    <Checkbox aria-invalid="true">Согласен на обработку персональных данных</Checkbox>
    <Checkbox aria-invalid="true" defaultChecked>
      Принимаю условия участия в программе НМО
    </Checkbox>
  </div>
);

export const WrappedLabel = () => (
  <div style={{ width: 280 }}>
    <Checkbox className="items-start">
      Согласие на передачу данных партнёрам платформы: без согласия часть материалов программы НМО
      недоступна.
    </Checkbox>
  </div>
);

export const OnPrimary = () => (
  <div className="flex flex-col items-start gap-3 bg-primary-surface p-4">
    <Checkbox tone="on-primary" defaultChecked>
      Согласен на обработку персональных данных
    </Checkbox>
    <Checkbox tone="on-primary" disabled>
      Подписка на рассылку недоступна
    </Checkbox>
  </div>
);

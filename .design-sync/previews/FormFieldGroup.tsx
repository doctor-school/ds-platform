import { FormFieldGroup, FormSection, Input, Label } from '@ds/design-system';

export const OneColumn = () => (
  <div style={{ width: 560 }}>
    <FormSection legend="Спикер" description="Как спикер подписан на странице эфира.">
      <FormFieldGroup>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ffg-name">ФИО спикера</Label>
          <Input id="ffg-name" defaultValue="Соколова Мария Андреевна" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ffg-regalia">Регалии</Label>
          <Input id="ffg-regalia" defaultValue="Д.м.н., профессор кафедры кардиологии" />
        </div>
      </FormFieldGroup>
    </FormSection>
  </div>
);

export const TwoColumns = () => (
  <div style={{ width: 560 }}>
    <FormSection legend="Время эфира">
      <FormFieldGroup columns="two">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ffg-date">Дата</Label>
          <Input id="ffg-date" defaultValue="07.10.2026" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ffg-time">Начало, МСК</Label>
          <Input id="ffg-time" defaultValue="19:00" />
        </div>
      </FormFieldGroup>
    </FormSection>
  </div>
);

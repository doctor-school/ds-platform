import { FormFieldGroup, FormSection, FormSeparator, Input, Label } from '@ds/design-system';

export const BetweenSections = () => (
  <div className="flex flex-col gap-6" style={{ width: 560 }}>
    <FormSection legend="Основное" description="Как эфир называется в расписании.">
      <FormFieldGroup>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fsep-title">Название эфира</Label>
          <Input id="fsep-title" defaultValue="Разбор клинических случаев в кардиологии" />
        </div>
      </FormFieldGroup>
    </FormSection>
    <FormSeparator />
    <FormSection legend="Баллы НМО" description="Сколько баллов получит врач за полный просмотр.">
      <FormFieldGroup>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fsep-nmo">Баллы</Label>
          <Input id="fsep-nmo" defaultValue="2" />
        </div>
      </FormFieldGroup>
    </FormSection>
  </div>
);

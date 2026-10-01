import {
  Button,
  FormActions,
  FormDerivedNote,
  FormFieldGroup,
  FormSection,
  FormSeparator,
  Input,
  Label,
  NativeSelect,
} from '@ds/design-system';

export const DirectionForm = () => (
  <form className="flex flex-col gap-6" style={{ width: 560 }}>
    <FormSection legend="Основное" description="Как направление называется в каталоге и в поиске.">
      <FormFieldGroup>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fs-title">Название направления</Label>
          <Input id="fs-title" defaultValue="Клиническая лабораторная диагностика" />
        </div>
      </FormFieldGroup>
      <FormFieldGroup columns="two">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fs-code">Код номенклатуры</Label>
          <Input id="fs-code" defaultValue="31.08.05" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fs-parent">Родительское направление</Label>
          <NativeSelect id="fs-parent" defaultValue="diagnostics">
            <option value="diagnostics">Диагностика</option>
            <option value="surgery">Хирургия</option>
            <option value="womens-health">Женское здоровье</option>
          </NativeSelect>
        </div>
      </FormFieldGroup>
      <FormDerivedNote title="Адрес страницы">
        academy.doctor.school/napravleniya/klinicheskaya-laboratornaya-diagnostika — адрес перестанет
        меняться после первой публикации.
      </FormDerivedNote>
    </FormSection>
    <FormSeparator />
    <FormSection legend="Публикация" description="Где направление показывается врачу.">
      <FormFieldGroup>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fs-status">Статус</Label>
          <NativeSelect id="fs-status" defaultValue="draft">
            <option value="draft">Черновик</option>
            <option value="published">Опубликовано</option>
          </NativeSelect>
        </div>
      </FormFieldGroup>
    </FormSection>
    <FormActions secondary={<Button variant="outline">Отмена</Button>}>
      <Button type="submit">Сохранить</Button>
    </FormActions>
  </form>
);

export const Locked = () => (
  <div style={{ width: 560 }}>
    <FormSection
      legend="Адрес страницы"
      description="Зафиксирован после первой публикации — старые ссылки не должны ломаться."
      locked
    >
      <FormFieldGroup>
        <div className="flex flex-col gap-2">
          <Label htmlFor="fs-slug">Адрес</Label>
          <Input id="fs-slug" defaultValue="klinicheskaya-laboratornaya-diagnostika" disabled />
        </div>
      </FormFieldGroup>
    </FormSection>
  </div>
);

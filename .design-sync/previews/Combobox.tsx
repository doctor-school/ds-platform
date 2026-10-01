import type { ReactNode } from 'react';
import { Combobox, Label } from '@ds/design-system';

const LINK_KINDS = [
  {
    value: 'adjacent_area',
    label: 'Смежная область',
    description: 'Направления пересекаются, но ни одно не входит в другое',
  },
  {
    value: 'narrower',
    label: 'Более узкое направление',
    description: 'Частный случай выбранного направления',
  },
  {
    value: 'broader',
    label: 'Более широкое направление',
    description: 'Выбранное направление входит в это',
  },
  {
    value: 'diagnostic_support',
    label: 'Диагностическая поддержка',
    description: 'Помогает ставить диагноз в выбранном направлении',
  },
];

const Field = ({ id, label, children }: { id: string; label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2" style={{ width: 360 }}>
    <Label htmlFor={id}>{label}</Label>
    {children}
  </div>
);

export const Selected = () => (
  <Field id="cb-kind" label="Вид связи">
    <Combobox
      id="cb-kind"
      options={LINK_KINDS}
      value="narrower"
      onValueChange={() => {}}
      placeholder="Выберите вид связи"
      emptyLabel="Ничего не найдено"
    />
  </Field>
);

export const Placeholder = () => (
  <Field id="cb-specialty" label="Специальность">
    <Combobox
      id="cb-specialty"
      options={[
        { value: 'cardiology', label: 'Кардиология' },
        { value: 'endocrinology', label: 'Эндокринология' },
        { value: 'neurology', label: 'Неврология' },
      ]}
      onValueChange={() => {}}
      placeholder="Выберите специальность"
      emptyLabel="Ничего не найдено"
    />
  </Field>
);

export const Invalid = () => (
  <Field id="cb-invalid" label="Вид связи">
    <Combobox
      id="cb-invalid"
      options={LINK_KINDS}
      onValueChange={() => {}}
      placeholder="Выберите вид связи"
      emptyLabel="Ничего не найдено"
      invalid
    />
  </Field>
);

export const Disabled = () => (
  <Field id="cb-disabled" label="Вид связи">
    <Combobox
      id="cb-disabled"
      options={LINK_KINDS}
      value="broader"
      onValueChange={() => {}}
      placeholder="Выберите вид связи"
      emptyLabel="Ничего не найдено"
      disabled
    />
  </Field>
);

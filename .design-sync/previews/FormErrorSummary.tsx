import { Button, FormErrorSummary, Input, Label, NativeSelect } from '@ds/design-system';

export const Summary = () => (
  <div className="flex flex-col gap-4" style={{ width: 360 }}>
    <Button type="button">Отправить заявку</Button>
    <FormErrorSummary
      title="Проверьте отмеченные поля"
      errors={[
        { fieldId: 'summary-name', message: 'Укажите фамилию и имя' },
        { fieldId: 'summary-specialty', message: 'Выберите специальность' },
        { fieldId: 'summary-email', message: 'Неверный формат e-mail' },
      ]}
    />
  </div>
);

export const InLongForm = () => (
  <form className="flex flex-col gap-4" style={{ width: 360 }} onSubmit={(e) => e.preventDefault()}>
    <div className="flex flex-col gap-2">
      <Label htmlFor="lf-name" required>
        Фамилия и имя
      </Label>
      <Input id="lf-name" aria-invalid="true" />
    </div>
    <div className="flex flex-col gap-2">
      <Label htmlFor="lf-specialty" required>
        Специальность
      </Label>
      <NativeSelect id="lf-specialty" aria-invalid="true" defaultValue="">
        <option value="" disabled>
          Выберите специальность
        </option>
        <option value="cardio">Кардиология</option>
        <option value="neuro">Неврология</option>
      </NativeSelect>
    </div>
    <Button type="submit">Отправить заявку</Button>
    <FormErrorSummary
      title="Проверьте отмеченные поля"
      errors={[
        { fieldId: 'lf-name', message: 'Укажите фамилию и имя' },
        { fieldId: 'lf-specialty', message: 'Выберите специальность' },
      ]}
    />
  </form>
);

import { Button, FormActions } from '@ds/design-system';

export const PrimaryAndSecondary = () => (
  <div style={{ width: 560 }}>
    <FormActions secondary={<Button variant="outline">Отмена</Button>}>
      <Button type="submit">Сохранить</Button>
    </FormActions>
  </div>
);

export const PrimaryOnly = () => (
  <div style={{ width: 560 }}>
    <FormActions>
      <Button type="submit">Опубликовать эфир</Button>
    </FormActions>
  </div>
);

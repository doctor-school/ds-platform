import { Badge } from '@ds/design-system';

export const Live = () => <Badge variant="live">В эфире</Badge>;

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Badge variant="live">В эфире</Badge>
    <Badge variant="label">Кардиология</Badge>
    <Badge variant="speaker">Спикер</Badge>
    <Badge variant="success">Запись доступна</Badge>
    <Badge variant="updated">Обновлено</Badge>
  </div>
);

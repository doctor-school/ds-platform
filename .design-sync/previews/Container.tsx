import { Container } from '@ds/design-system';

export const Content = () => (
  <div className="w-full">
    <Container variant="content" className="bg-section py-4">
      <div className="border-2 border-border bg-card p-inset text-sm text-foreground">
        Ближайшие эфиры — колонка контента с адаптивным полем
      </div>
    </Container>
  </div>
);

export const Calendar = () => (
  <div className="w-full">
    <Container variant="calendar" className="bg-section py-4">
      <div className="border-2 border-border bg-card p-inset text-sm text-foreground">
        Календарь мероприятий — широкая колонка
      </div>
    </Container>
  </div>
);

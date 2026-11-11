import { EventPageSkeleton, EventPageStateFrame } from '@ds/design-system';

export const Loading = () => (
  <EventPageStateFrame>
    <EventPageSkeleton label="Загружаем событие" />
  </EventPageStateFrame>
);

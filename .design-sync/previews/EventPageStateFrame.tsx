import { EventPageStateFrame } from '@ds/design-system';

export const ErrorCard = () => (
  <EventPageStateFrame>
    <div className="border-2 border-border bg-card px-7 py-10 text-center shadow-lg">
      <p className="text-xl font-extrabold tracking-tight text-foreground">
        Не получилось загрузить событие
      </p>
    </div>
  </EventPageStateFrame>
);

import { EventFormatSeatsPanel } from '@ds/design-system';

export const SeatsLeft = () => (
  <div style={{ width: 640 }}>
    <EventFormatSeatsPanel seatsLine="Осталось 12 мест" />
  </div>
);

export const NoSeatsLeft = () => (
  <div style={{ width: 640 }}>
    <EventFormatSeatsPanel seatsLine="Мест не осталось" />
  </div>
);

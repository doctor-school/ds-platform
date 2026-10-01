import { EventSectionHeading } from '@ds/design-system';

export const SectionRule = () => (
  <div style={{ width: 640 }}>
    <EventSectionHeading>Программа</EventSectionHeading>
  </div>
);

export const OverReadingFlow = () => (
  <div style={{ width: 640 }}>
    <EventSectionHeading>О чём событие</EventSectionHeading>
    <p className="mt-4 text-sm leading-relaxed text-foreground">
      PRP-терапия при гонартрозе: показания, доказательная база и рабочие протоколы. Разбираем
      реальный клинический случай — от отбора пациента до оценки результата через 6 месяцев.
    </p>
  </div>
);

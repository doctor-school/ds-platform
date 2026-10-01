import { EventAboutSection } from '@ds/design-system';

export const About = () => (
  <div style={{ width: 640 }}>
    <EventAboutSection
      heading="О чём событие"
      description="PRP-терапия при гонартрозе: показания, доказательная база и рабочие протоколы. Разбираем реальный клинический случай — от отбора пациента до оценки результата через 6 месяцев."
    />
  </div>
);

export const ShortDescription = () => (
  <div style={{ width: 640 }}>
    <EventAboutSection
      heading="О чём событие"
      description="Клуб ревматологов: разбор двух сложных случаев спондилоартрита и открытые вопросы коллег."
    />
  </div>
);

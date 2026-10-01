import { EventSpeakerCard } from '@ds/design-system';

export const FullWithInitials = () => (
  <div style={{ width: 640 }}>
    <EventSpeakerCard
      name="Михаил Страхов"
      roleKicker="Травматолог-ортопед"
      affiliation="РНИМУ им. Пирогова"
      bio="Д.м.н., профессор кафедры травматологии и ортопедии, ведёт направление ортобиологии на платформе. Автор 40+ публикаций по регенеративным методикам."
      initials="МС"
      href="#expert"
      footerLabel="12 эфиров · страница эксперта →"
      footerHref="#expert"
    />
  </div>
);

export const SecondSpeakerNoHeading = () => (
  <div style={{ width: 640 }}>
    <EventSpeakerCard
      heading={null}
      name="Ольга Литвинова"
      roleKicker="Ревматолог"
      affiliation="НИИ ревматологии"
      initials="ОЛ"
    />
  </div>
);

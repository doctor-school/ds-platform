import { DayAgenda } from '@ds/design-system';

export const Populated = () => (
  <div style={{ width: 360 }}>
    <DayAgenda
      title="7 июля, вторник · сегодня"
      emptyText="В этот день эфиров нет"
      rows={[
        {
          href: '#',
          time: '19:00',
          school: 'Школа кардиологии',
          title: 'Прямой эфир: разбор случаев',
          live: true,
          liveLabel: 'LIVE',
        },
        {
          href: '#',
          time: '20:30',
          school: 'Школа терапии',
          title: 'Новое в терапии 2026',
          liveLabel: 'LIVE',
        },
      ]}
    />
  </div>
);

export const EmptyDay = () => (
  <div style={{ width: 360 }}>
    <DayAgenda title="9 июля, четверг" rows={[]} emptyText="В этот день эфиров нет" />
  </div>
);

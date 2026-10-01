import { WebinarRecordingPlaque } from '@ds/design-system';

export const Dated = () => (
  <div style={{ width: 720 }}>
    <WebinarRecordingPlaque
      timeLabel="Запись"
      time="до 18 июля"
      title="Запись готовится"
      body="Монтируем запись — опубликуем на этой странице до 18 июля."
    />
  </div>
);

export const Undated = () => (
  <div style={{ width: 720 }}>
    <WebinarRecordingPlaque
      timeLabel="Запись"
      title="Запись готовится"
      body="Монтируем запись — она появится на этой странице, как только будет готова."
    />
  </div>
);

import { RecordingSpoiler } from '@ds/design-system';

const player = (
  <div className="flex w-full aspect-video items-center justify-center bg-header text-sm text-neutral-300">
    Оригинал трансляции
  </div>
);

export const CollapsedWithHint = () => (
  <div style={{ width: 640 }}>
    <RecordingSpoiler
      summaryLabel="Смотреть оригинал трансляции"
      hint="без монтажа, с паузами и вопросами между блоками"
    >
      {player}
    </RecordingSpoiler>
  </div>
);

export const CollapsedNoHint = () => (
  <div style={{ width: 640 }}>
    <RecordingSpoiler summaryLabel="Смотреть оригинал трансляции">{player}</RecordingSpoiler>
  </div>
);

export const Open = () => (
  <div style={{ width: 640 }}>
    <RecordingSpoiler
      defaultOpen
      summaryLabel="Смотреть оригинал трансляции"
      hint="без монтажа, с паузами и вопросами между блоками"
    >
      {player}
    </RecordingSpoiler>
  </div>
);

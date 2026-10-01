import { DayBand } from '@ds/design-system';

export const Today = () => (
  <div style={{ width: 560 }}>
    <DayBand>Сегодня — 16 июля</DayBand>
  </div>
);

export const HeadingCards = () => (
  <div className="flex flex-col" style={{ width: 560 }}>
    <DayBand>Четверг — 17 июля</DayBand>
    <div className="border-2 border-border bg-card p-4 text-sm text-foreground">
      19:00 · Вебинар «Фибрилляция предсердий: антикоагулянтная терапия»
    </div>
  </div>
);

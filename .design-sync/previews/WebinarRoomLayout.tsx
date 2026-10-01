import { Badge, WebinarRoomLayout } from '@ds/design-system';

const player = (
  <>
    <Badge variant="live" className="absolute left-4 top-4 z-10">
      В эфире
    </Badge>
    <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300">
      Плеер эфира
    </div>
  </>
);

const contextStrip = (
  <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
    <span className="text-2xs font-extrabold uppercase tracking-micro text-primary-action whitespace-nowrap">
      Школа травматологии и ортопедии · Эфир № 042
    </span>
    <span className="text-sm font-extrabold tracking-tight text-foreground">
      Пластика ахиллова сухожилия: разбор случаев
    </span>
    <span className="text-caption text-muted-foreground">Анна Соколова · Михаил Верещагин</span>
  </div>
);

const context = (
  <div>
    <p className="text-caption font-extrabold uppercase tracking-micro text-primary-action">
      Школа травматологии и ортопедии
    </p>
    <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground">
      Пластика ахиллова сухожилия: разбор случаев
    </h1>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Анна Соколова · Михаил Верещагин</p>
  </div>
);

const chat = (
  <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-none border-b-2 border-hairline bg-tint px-4 py-2.5 text-caption leading-relaxed text-tint-foreground">
      Модератор: вопросы можно задавать прямо в чате.
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3">
      <div className="text-sm leading-relaxed text-foreground break-words">
        <span className="font-bold text-foreground">Ирина К.</span> Уже в эфире, коллеги!
      </div>
      <div className="text-sm leading-relaxed text-foreground break-words">
        <span className="font-bold text-foreground">Дмитрий П.</span> Отличный разбор доступов, спасибо!
      </div>
      <div className="text-sm leading-relaxed text-foreground break-words">
        <span className="font-bold text-primary-action">Вы</span> Ждём блок вопросов по реабилитации.
      </div>
    </div>
    <div className="flex flex-none gap-3 border-t-2 border-border p-4">
      <input
        placeholder="Написать в чат…"
        aria-label="Написать в чат"
        disabled
        className="min-w-0 flex-1 border-2 border-hairline bg-card px-4 py-3 text-sm text-foreground"
      />
      <button
        type="button"
        disabled
        className="border-2 border-border bg-primary-action px-4 py-3 text-sm font-extrabold text-primary-foreground shadow-sm"
      >
        Отправить
      </button>
    </div>
  </div>
);

const copy = {
  chatTabLabel: 'Чат',
  infoTabLabel: 'О эфире',
  chatHeading: 'Чат эфира',
  collapseLabel: 'Свернуть чат',
  expandLabel: 'Развернуть чат',
};

const slimBar = (
  <div className="flex-none border-b-2 border-border bg-card px-4 py-2.5 text-caption text-muted-foreground">
    Пластика ахиллова сухожилия · Анна Соколова
  </div>
);

// The capture viewport is 900px wide, below the 901px layout breakpoint, so the
// room renders its mobile shape: full-bleed player + Чат / О эфире tabs.
export const MobileChatTab = () => (
  <div className="flex" style={{ width: 390, height: 640 }}>
    <WebinarRoomLayout
      {...copy}
      chatCount={214}
      player={player}
      contextStrip={contextStrip}
      context={context}
      chat={chat}
    />
  </div>
);

export const MobileWithSlimBar = () => (
  <div className="flex" style={{ width: 390, height: 640 }}>
    <WebinarRoomLayout
      {...copy}
      chatCount={214}
      player={player}
      slimBar={slimBar}
      contextStrip={contextStrip}
      context={context}
      chat={chat}
    />
  </div>
);

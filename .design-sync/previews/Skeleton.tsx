import { Skeleton } from '@ds/design-system';

export const Lines = () => (
  <div className="flex items-center gap-4" style={{ width: 420 }}>
    <Skeleton className="size-14" />
    <div className="flex flex-1 flex-col" style={{ gap: 'calc(var(--spacing) * 2.5)' }}>
      <Skeleton className="h-3" style={{ width: '60%' }} />
      <Skeleton className="h-3" style={{ width: '85%' }} />
      <Skeleton className="h-3" style={{ width: '40%' }} />
    </div>
  </div>
);

export const LoadingCard = () => (
  <div
    role="status"
    aria-busy="true"
    className="flex items-center gap-4 border-2 border-border bg-card p-4"
    style={{ width: 420 }}
  >
    <span className="sr-only">Загружаем профиль…</span>
    <Skeleton className="size-14" />
    <div className="flex flex-1 flex-col" style={{ gap: 'calc(var(--spacing) * 2.5)' }}>
      <Skeleton className="h-3" style={{ width: '60%' }} />
      <Skeleton className="h-3" style={{ width: '85%' }} />
      <Skeleton className="h-3" style={{ width: '40%' }} />
    </div>
  </div>
);

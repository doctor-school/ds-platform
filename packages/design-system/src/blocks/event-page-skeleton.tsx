import * as React from "react";

import { cn } from "../lib/utils";
import { Skeleton } from "../primitives/skeleton";
import { EventPageStateFrame } from "./event-page-shell";

export interface EventPageSkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The wait announced to assistive tech only («Загружаем событие»). */
  label: string;
}

/**
 * 020 EARS-19 (wave-3 gate row 29, D8) — the event page while its reads are in
 * flight: the canvas `pageState: загрузка` skeleton
 * (`design-source/event-page.dc.html` L42–L54) — a hairline card with the
 * 160×90 poster block and two lines (60 % / 40 %), then the reading column
 * (35/90/80/85 %) beside the aside (45 % + a 96px block). The geometry is the
 * canvas's, owned here so a storefront mounts it without restyling the
 * `Skeleton` primitive. It sits in {@link EventPageStateFrame}, under the poster
 * band in the canvas's -80px overlap. The wait is not a message: the label is screen-reader
 * only. Presentation only; the copy is app-supplied.
 */
export function EventPageSkeleton({
  label,
  className,
  ...rest
}: EventPageSkeletonProps) {
  return (
    <EventPageStateFrame>
      <div
        role="status"
        aria-busy="true"
        data-testid="event-page-skeleton"
        className={cn(className)}
        {...rest}
      >
        <span className="sr-only">{label}</span>
        <div className="flex flex-wrap gap-6 border-2 border-hairline bg-card p-7">
          <Skeleton className="h-22.5 w-40 flex-none" />
          <div className="flex min-w-50 flex-1 flex-col justify-center gap-3.5">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-12 layout:grid-cols-3">
          <div className="flex flex-col gap-4.5 layout:col-span-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-9/10" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-17/20" />
          </div>
          <div className="flex flex-col gap-4.5">
            <Skeleton className="h-3.5 w-9/20" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </div>
    </EventPageStateFrame>
  );
}

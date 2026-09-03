import * as React from "react";

import { cn } from "../lib/utils";
import { EventSectionHeading } from "./event-page-shell";

/**
 * `EventFormatBlock` (020 EARS-1, #1764) — the canvas's «Эфир» block: when the
 * room opens, and what happens inside it.
 *
 * `kind` is deliberately the single-member union `"online"`. The offline and
 * hybrid format blocks are EARS-8's deliverable (#1771) and arrive with their
 * own copy and content; adding empty members or placeholder branches here would
 * be an untracked seam (AGENTS.md §6), so the union widens in #1771 instead.
 */
export interface EventFormatBlockProps {
  kind: "online";
  /** Canvas-fixed section label; overridable for the Academy's voice. */
  heading?: React.ReactNode;
  /** «Комната эфира откроется за 10 минут до начала». */
  roomOpensLine: React.ReactNode;
  /** «Во время эфира: вопрос лектору · опросы · отметки присутствия для НМО». */
  duringLine?: React.ReactNode;
  className?: string;
}

export function EventFormatBlock({
  heading = "Эфир",
  roomOpensLine,
  duringLine,
  className,
}: EventFormatBlockProps) {
  return (
    <section
      data-testid="event-format-block"
      data-format-kind="online"
      className={cn(className)}
    >
      <EventSectionHeading className="mb-7">{heading}</EventSectionHeading>
      <div className="flex flex-col gap-3 border-2 border-border bg-card px-7 py-6 shadow-lg">
        <span className="text-base font-bold text-card-foreground">{roomOpensLine}</span>
        {duringLine ? (
          <span className="text-caption font-bold leading-relaxed text-faint">
            {duringLine}
          </span>
        ) : null}
      </div>
    </section>
  );
}

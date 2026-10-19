import * as React from "react";

import { cn } from "../lib/utils";
import { EventSectionHeading } from "./event-page-shell";

/**
 * `EventFormatBlock` (020 EARS-1 / EARS-8 / EARS-9) — the canvas's format
 * block, the only part of the event page that differs between formats.
 *
 * - `online` — the «Эфир» block: when the room opens, and what happens inside.
 * - `offline` — the remaining seats. No ticket, no QR and no door-scan
 *   affordance (EARS-15 is wave 2) and no venue lines (address, map, «как
 *   добраться» — no field exists, #1771); the block carries only what the read
 *   knows.
 * - `hybrid` — both halves behind a «очно / онлайн» switcher the PAGE supplies
 *   (the active tab is URL state, a routing concern a design-system block does
 *   not own), with the plain EARS-9 statement above it when the offline seats
 *   are gone.
 *
 * The tab bodies are {@link EventFormatRoomPanel} and
 * {@link EventFormatSeatsPanel}, the same panels the single-format variants
 * render, so a hybrid tab and a single-format block cannot drift apart.
 */
export type EventFormatBlockProps = {
  /** Canvas-fixed section label; overridable for the Academy's voice. */
  heading?: React.ReactNode;
  className?: string;
} & (
  | ({ kind: "online" } & EventFormatRoomPanelProps)
  | ({ kind: "offline" } & EventFormatSeatsPanelProps)
  | {
      kind: "hybrid";
      /** EARS-9 — why the block opens on «онлайн»; `null` while seats remain. */
      statement?: { title: React.ReactNode; body: React.ReactNode } | null;
      /** The «очно / онлайн» tabs with their panels. */
      switcher: React.ReactNode;
    }
);

export interface EventFormatRoomPanelProps {
  /** «Комната эфира откроется за 10 минут до начала» — before the start only. */
  roomOpensLine?: React.ReactNode;
  /** «Во время эфира: вопрос лектору · опросы · отметки присутствия». */
  duringLine?: React.ReactNode;
}

export interface EventFormatSeatsPanelProps {
  /** «Осталось 12 мест» / «Мест не осталось». */
  seatsLine: React.ReactNode;
}

const PANEL =
  "flex flex-col gap-3 border-2 border-border bg-card px-7 py-6 shadow-lg";

export function EventFormatRoomPanel({
  roomOpensLine,
  duringLine,
}: EventFormatRoomPanelProps) {
  return (
    <div className={PANEL}>
      {roomOpensLine ? (
        <span className="text-base font-bold text-card-foreground">
          {roomOpensLine}
        </span>
      ) : null}
      {duringLine ? (
        <span className="text-caption font-bold leading-relaxed text-faint">
          {duringLine}
        </span>
      ) : null}
    </div>
  );
}

export function EventFormatSeatsPanel({
  seatsLine,
}: EventFormatSeatsPanelProps) {
  return (
    <div className={PANEL}>
      <span
        data-testid="event-format-seats"
        className="text-base font-bold tabular-nums text-card-foreground"
      >
        {seatsLine}
      </span>
    </div>
  );
}

export function EventFormatBlock(props: EventFormatBlockProps) {
  const { heading = "Эфир", className } = props;
  return (
    <section
      data-testid="event-format-block"
      data-format-kind={props.kind}
      className={cn(className)}
    >
      <EventSectionHeading className="mb-7">{heading}</EventSectionHeading>
      {props.kind === "online" ? (
        <EventFormatRoomPanel
          roomOpensLine={props.roomOpensLine}
          duringLine={props.duringLine}
        />
      ) : props.kind === "offline" ? (
        <EventFormatSeatsPanel seatsLine={props.seatsLine} />
      ) : (
        <>
          {props.statement ? (
            <div
              data-testid="event-format-statement"
              className="mb-5 border-2 border-border bg-card px-6 py-5"
            >
              <p className="text-base font-extrabold text-card-foreground">
                {props.statement.title}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {props.statement.body}
              </p>
            </div>
          ) : null}
          {props.switcher}
        </>
      )}
    </section>
  );
}

import * as React from "react";
import type { ParticipationCta } from "@ds/schemas";

import { cn } from "../lib/utils";
import { Button } from "../primitives/button";

/**
 * `EventSignupCard` (020 EARS-1, #1764) — the single right-column card of the
 * variant-А canvas (`design-source/webinar-page-variant-a.dc.html`): the date
 * plate, the conditions rows, and the ONE participation control.
 *
 * The card renders {@link ParticipationCta} EXACTLY as the server resolved it
 * (LD-2). It computes nothing from lifecycle, format, registration or seats —
 * any such branch here would be the second policy the contract exists to
 * prevent. Where participation is impossible the control is ABSENT rather than
 * disabled (EARS-4): `sold-out` and `unavailable` dead-end in words, and
 * `enter-room` without an `href` renders no control at all rather than a dead
 * one.
 */

/** One «Участие · Формат · Длительность · НМО» row; the value is host-rendered. */
export interface EventSignupCondition {
  label: React.ReactNode;
  value: React.ReactNode;
  /**
   * The value's emphasis. `success` is the canvas's green «Бесплатно для врача»
   * (canvas:209) — a token pair, so it holds its AA contrast in dark as well;
   * omitted is the default foreground every other row carries.
   */
  tone?: "default" | "success";
}

export interface EventSignupCardProps {
  /** «19:00» — the start time, set on the tinted plate. */
  timeLabel: React.ReactNode;
  /** «28 августа». */
  dateLabel: React.ReactNode;
  /** «пятница · МСК» — weekday and the timezone the time is stated in. */
  weekdayLabel?: React.ReactNode;
  conditions?: readonly EventSignupCondition[];
  /** The server-resolved participation policy — rendered as given. */
  cta: ParticipationCta;
  /** «Нужна регистрация — вернём вас на эту страницу.» — host-supplied. */
  note?: React.ReactNode;
  /** Social-proof slot; filled by EARS-3 (#1767), empty until then. */
  proof?: React.ReactNode;
  /** Sticks to the viewport on desktop only (canvas «Развилка 1 · вариант А»). */
  pinned?: boolean;
  /**
   * The host's own control ELEMENT for the action the server already resolved —
   * used when the action is a COMMAND rather than a navigation (the academy's
   * 005 EARS-1 one-tap register, which POSTs and re-reads in place instead of
   * routing through auth).
   *
   * It is a rendering slot, never a policy hook: `cta.action` alone still decides
   * WHETHER a control renders at all, and this node is ignored in every branch
   * that the policy says carries no target. A host therefore cannot use it to
   * put a participation control where the server said there is none.
   */
  control?: React.ReactNode;
  className?: string;
}

/** Actions that lead somewhere — each renders a control only when `href` is set. */
const LINKED_ACTIONS: ReadonlySet<ParticipationCta["action"]> = new Set([
  "register",
  "switch-to-online",
  "enter-room",
  "registered",
]);

/** Actions that are honest in words and carry no control, ever. */
const STATEMENT_ACTIONS: ReadonlySet<ParticipationCta["action"]> = new Set([
  "registered",
  "sold-out",
  "unavailable",
]);

export function EventSignupCard({
  timeLabel,
  dateLabel,
  weekdayLabel,
  conditions,
  cta,
  note,
  proof,
  pinned = false,
  control: hostControl,
  className,
}: EventSignupCardProps) {
  const linked = LINKED_ACTIONS.has(cta.action) && cta.href !== null;
  // The host slot substitutes for the generated link ONLY inside the branch the
  // policy already opened; it can never open one of its own.
  const control = !linked ? null : (
    (hostControl ?? (
      <Button asChild className="mt-3.5 w-full" data-testid="event-signup-cta">
        <a href={cta.href as string}>
          {cta.label}
          <span aria-hidden="true">↗</span>
        </a>
      </Button>
    ))
  );

  const statement =
    !linked && STATEMENT_ACTIONS.has(cta.action) ? (
      <p
        data-testid="event-signup-statement"
        className="mt-3.5 text-caption font-extrabold text-foreground"
      >
        {cta.label}
      </p>
    ) : null;

  return (
    <div
      data-testid="event-signup-card"
      data-cta-action={cta.action}
      className={cn(pinned && "layout:sticky layout:top-5", className)}
    >
      <div className="border-2 border-border bg-card shadow-lg">
        <div className="flex items-center gap-3.5 border-b-2 border-border bg-tint px-6 py-5">
          <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums text-tint-foreground">
            {timeLabel}
          </span>
          <span className="text-caption font-extrabold uppercase leading-snug tracking-wider text-tint-foreground">
            {dateLabel}
            {weekdayLabel ? (
              <>
                <br />
                {weekdayLabel}
              </>
            ) : null}
          </span>
        </div>
        <div className="px-6 py-5">
          {conditions?.map((condition, index) => (
            <div
              key={index}
              className="flex items-baseline justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0"
            >
              <span className="text-xs font-bold text-faint">{condition.label}</span>
              <span
                data-tone={condition.tone ?? "default"}
                className={cn(
                  "text-caption font-extrabold",
                  condition.tone === "success"
                    ? "text-success-text"
                    : "text-card-foreground",
                )}
              >
                {condition.value}
              </span>
            </div>
          ))}
          {control}
          {statement}
          {cta.reason ? (
            <p
              data-testid="event-signup-reason"
              className="mt-3 text-caption leading-relaxed text-muted-foreground"
            >
              {cta.reason}
            </p>
          ) : null}
          {note ? (
            <div className="mt-3 text-caption leading-relaxed text-muted-foreground">
              {note}
            </div>
          ) : null}
          {proof ? (
            <div
              data-testid="event-signup-proof"
              className="mt-2.5 border-t border-hairline pt-3 text-caption font-extrabold text-card-foreground"
            >
              {proof}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

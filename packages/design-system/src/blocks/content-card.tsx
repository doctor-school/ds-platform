import * as React from "react";

import { cn } from "../lib/utils";
import { Card } from "../primitives/card";

/**
 * The ONE content card unit of the platform (018 EARS-2, #1497; convergence
 * #1430): the doctor content card, the 048 feed card (#3516) and the 030 project
 * card (#3506) are variants of THIS module, not three components (registry
 * `specs/product/two-site-ia/capability-ownership.md` row «Content / feed card»).
 * A later variant joins here behind a discriminant; only the doctor variant
 * exists today.
 *
 * `DoctorContentCard` is Stage-A variant «Б — типографская»
 * (`design-source/unit-content-card.dc.html`, owner pick F-018-2): a tint metric
 * column beside a body of kicker, title, progress and a footer of counter + call
 * to action. There is NO cover-image field, so the component's shape creates no
 * content-production obligation (018 design §2, LD-2).
 *
 * Presentation only. `started` / `completed` / `gate` are viewer-dependent and
 * `soon` follows the publication state — all resolved on the server and passed
 * in as `state` (018 design §2, LD-4); the card holds no session, progress or
 * fetch logic. Hover and focus are presentation states of the element itself.
 *
 * Token-only. Canvas values with no token map to the nearest token (the gaps are
 * listed in the #1497 PR body): the 5px offset shadow → `shadow-lg` at rest and
 * `shadow-md` + a 2px press on hover (the shadow's far edge stays put, as in the
 * canvas 5→4 + 1px), 19px title → `text-lg`, 32px metric → `text-2xl`, the green
 * counter / «Завершено» ink → `success-text` (the canvas green.500 fails AA for
 * 12–13px text on white), the blue kicker → `primary-action` (same AA reason,
 * the WebinarCard precedent). The canvas `.78` dim of `completed` is not applied:
 * it drops the metric label and the counter below AA (axe on the showcase).
 */

export type DoctorContentKind = "lesson" | "course" | "school";

export type DoctorContentCardState =
  "normal" | "started" | "completed" | "gate" | "soon";

/** The metric column: a number and its unit, e.g. `{ value: "9", label: "серий" }`. */
export interface DoctorContentCardMeta {
  value: string;
  label: string;
}

export interface DoctorContentCardProps {
  kind: DoctorContentKind;
  /** The type line above the title, e.g. «Курс-сериал». */
  kicker: string;
  title: string;
  /** Server-composed metadata (a course passes its series count as data). */
  meta: DoctorContentCardMeta;
  /** Social proof line; omit it when its source is unavailable — never pass a zero. */
  counter?: string | undefined;
  state: DoctorContentCardState;
  /** 0–100, meaningful only in `started`. */
  progress?: number | undefined;
  href: string;
}

const CTA_LABEL: Partial<Record<DoctorContentCardState, string>> = {
  normal: "Открыть →",
  started: "Продолжить →",
  completed: "Открыть снова →",
};

/**
 * The shared frame of the unit: the neo-brutalist card on desktop (2px border,
 * offset shadow, 1px-feel press on hover), flat at ≤900px (border 0, no shadow).
 * `soon` swaps the frame for the dashed outline and drops the lift.
 */
function ContentCardFrame({
  soon,
  className,
  ...props
}: React.ComponentProps<"div"> & { soon: boolean }) {
  return (
    <Card
      className={cn(
        "group relative flex flex-col border-0 shadow-none transition motion-reduce:transition-none",
        soon
          ? "layout:border-2 layout:border-dashed layout:border-muted-2"
          : "layout:border-2 layout:shadow-lg layout:hover:translate-x-0.5 layout:hover:translate-y-0.5 layout:hover:shadow-md",
        className,
      )}
      {...props}
    />
  );
}

export function DoctorContentCard({
  kind,
  kicker,
  title,
  meta,
  counter,
  state,
  progress,
  href,
}: DoctorContentCardProps) {
  const describedById = React.useId();
  const soon = state === "soon";
  const done = state === "completed";
  const gated = state === "gate";
  const started = state === "started";
  const pct = Math.max(0, Math.min(100, Math.round(Number(progress ?? 0))));
  const cta = CTA_LABEL[state];
  const progressLabel = `Вы прошли ${pct}%`;

  return (
    <ContentCardFrame
      soon={soon}
      data-content-card=""
      data-kind={kind}
      data-state={state}
    >
      <div className="flex flex-col layout:flex-row">
        {/* Metric column — the typographic «cover» of variant Б. */}
        <div
          className={cn(
            "flex items-baseline gap-2.5 bg-tint px-4 py-3.5",
            "layout:w-37.5 layout:shrink-0 layout:flex-col layout:items-start layout:justify-center layout:gap-0 layout:border-r-2 layout:px-4.5 layout:py-5",
            soon ? "layout:border-transparent" : "layout:border-border",
          )}
        >
          <span className="text-2xl font-extrabold leading-none tracking-numeric tabular-nums text-tint-foreground">
            {meta.value}
          </span>
          <span className="text-2xs font-extrabold uppercase tracking-micro text-tint-foreground layout:mt-1.5">
            {meta.label}
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col px-4 pt-4 pb-4.5 layout:px-6 layout:py-5">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "text-pill font-extrabold uppercase tracking-eyebrow",
                soon ? "text-faint" : "text-primary-action",
              )}
            >
              {kicker}
            </span>
            {soon ? (
              <span
                id={describedById}
                className="bg-tint px-2 py-0.75 text-2xs font-extrabold uppercase tracking-micro text-tint-foreground"
              >
                Скоро
              </span>
            ) : null}
            {done ? (
              <span
                id={describedById}
                className="ml-auto whitespace-nowrap text-xs font-extrabold text-success-text"
              >
                ✓ Завершено
              </span>
            ) : null}
          </div>

          {/* The TITLE is the card's one link; its `::after` stretches over the
            whole frame (the frame is `relative`), so the call to action and the
            gate footer stay text inside one keyboard target (WebinarCard
            precedent). The state line describes the link. */}
          <h3 className="text-lg font-extrabold leading-tight tracking-tight">
            <a
              href={href}
              aria-describedby={
                soon || done || gated ? describedById : undefined
              }
              className="text-card-foreground no-underline outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary-action focus-visible:text-primary-action focus-visible:after:shadow-focus"
            >
              {title}
            </a>
          </h3>

          {started ? (
            <div className="mt-4">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                aria-label={progressLabel}
                className="h-2 border border-hairline bg-section"
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.75 text-xs font-bold text-muted-foreground">
                {progressLabel}
              </div>
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap items-center gap-3.5 pt-3.5">
            {counter ? (
              <span className="text-caption font-extrabold text-success-text">
                {counter}
              </span>
            ) : null}
            {cta ? (
              <span
                aria-hidden="true"
                className="ml-auto whitespace-nowrap text-caption font-extrabold text-primary-action underline decoration-2 underline-offset-4"
              >
                {cta}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {gated ? (
        <div
          id={describedById}
          className="flex items-center gap-2.5 border-t-2 border-hairline bg-tint px-4.5 py-3 text-caption font-extrabold text-tint-foreground layout:border-border"
        >
          <span aria-hidden="true">🔒</span>
          Смотреть — нужна регистрация →
        </div>
      ) : null}
    </ContentCardFrame>
  );
}

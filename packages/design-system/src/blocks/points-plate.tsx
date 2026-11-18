import * as React from "react";

import { cn } from "../lib/utils";
import { Link } from "../primitives/link";

/**
 * `PointsPlate` — the ONE «Очки внимания» plate over the one 025 points ledger
 * (capability registry «Points plate (025)»): three columns — Pul, Bre, Con —
 * each with its balance, its name and what it is for, per the unit anatomy of
 * `design-source/doctor-lesson.dc.html` §4. The host reads the balances
 * (`GET /v1/me/points`) and passes them; `null` (a guest, no account) shows a
 * dash for each. The footer — the posting history link and a footnote — is
 * rendered only for what the host supplies, never as a dead link.
 */
export interface PointsPlateBalances {
  /** Pul the person may spend (the account's `pul.available`). */
  pul: number;
  bre: number;
  con: number;
}

export interface PointsPlateKind {
  key: keyof PointsPlateBalances;
  unit: string;
  name: string;
  caption: string;
}

/** The canvas copy of the three kinds (doctor-lesson.dc.html §4). */
export const POINTS_PLATE_KINDS: readonly PointsPlateKind[] = [
  {
    key: "pul",
    unit: "Pul",
    name: "Пульс",
    caption:
      "Ваш вклад в собственное образование — тратится на записи и доступы.",
  },
  {
    key: "bre",
    unit: "Bre",
    name: "Дыхание",
    caption: "Репутация среди коллег: растёт за ответы и активность.",
  },
  {
    key: "con",
    unit: "Con",
    name: "Сознание",
    caption: "Итог пути: начисляется за завершённые шаги и только растёт.",
  },
];

const AMOUNT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export interface PointsPlateProps {
  balances: PointsPlateBalances | null;
  heading?: React.ReactNode;
  kinds?: readonly PointsPlateKind[];
  /** The posting history; the link is absent without it. */
  historyHref?: string;
  historyLabel?: React.ReactNode;
  footnote?: React.ReactNode;
  className?: string;
}

export function PointsPlate({
  balances,
  heading = "Очки внимания",
  kinds = POINTS_PLATE_KINDS,
  historyHref,
  historyLabel = "История начислений",
  footnote,
  className,
}: PointsPlateProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid="points-plate"
      className={cn(className)}
    >
      <div className="mb-6 flex items-baseline gap-4">
        <h2
          id={headingId}
          className="whitespace-nowrap text-2xl font-extrabold leading-display tracking-tight text-foreground"
        >
          {heading}
        </h2>
        <span aria-hidden="true" className="flex-1 border-t-2 border-border" />
      </div>
      <div className="border-2 border-border bg-card text-card-foreground shadow-lg">
        <div className="grid grid-cols-1 md:grid-cols-3">
          {kinds.map((k, i) => (
            <div
              key={k.key}
              data-testid="points-plate-kind"
              className={cn(
                "min-w-0 p-4 md:p-6",
                i > 0 &&
                  "border-t border-hairline md:border-t-0 md:border-l-2 md:border-border",
              )}
            >
              <div
                data-testid="points-plate-value"
                className="text-2xl font-extrabold leading-none tracking-numeric text-tint-foreground tabular-nums"
              >
                {balances ? AMOUNT.format(balances[k.key]) : "—"} {k.unit}
              </div>
              <div className="mt-2 text-eyebrow font-extrabold uppercase tracking-eyebrow">
                {k.name}
              </div>
              <div className="mt-1.5 text-caption font-semibold leading-prose text-muted-foreground">
                {k.caption}
              </div>
            </div>
          ))}
        </div>
        {historyHref || footnote ? (
          <div
            data-testid="points-plate-footer"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-border bg-section px-6 py-3"
          >
            {historyHref ? (
              <Link href={historyHref} size="sm">
                {historyLabel}
              </Link>
            ) : null}
            {footnote ? (
              <span className="min-w-0 flex-1 basis-56 text-caption font-semibold text-muted-foreground">
                {footnote}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

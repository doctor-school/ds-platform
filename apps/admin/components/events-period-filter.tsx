"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@ds/design-system";
import { FormError } from "@ds/design-system/form";

export interface EventsPeriod {
  /** The first Moscow calendar day (`YYYY-MM-DD`); `""` = open. */
  startsFrom: string;
  /** The last Moscow calendar day (`YYYY-MM-DD`); `""` = open. */
  startsTo: string;
}

/**
 * 007 EARS-14 — the start-date period of the admin event list: two Moscow
 * calendar days, both ends inclusive, applied INSTANTLY like every other facet
 * of the bar. The same control and the same refusal as the 044 roster's
 * registration range (`roster-filters-panel.tsx`): a «по» before the «с» stays
 * in its field with an inline error and is NOT applied, so an inverted period
 * never reaches the route's 400 — the list stays narrowed by the «с» alone.
 *
 * `onChange` receives an UPDATE of the period as the address holds it at that
 * moment (the page reads `window.location`), never this render's copy: two days
 * picked back to back must not overwrite each other.
 */
export function EventsPeriodFilter({
  period,
  onChange,
}: {
  period: EventsPeriod;
  onChange: (
    update: (current: EventsPeriod) => Partial<EventsPeriod>,
  ) => void;
}) {
  const t = useTranslations();
  // The typed «по» while it lies before the «с» (not applied); `null` = the
  // field shows the applied value.
  const [invertedTo, setInvertedTo] = useState<string | null>(null);
  // «Сбросить всё» or the period chip removed the «с»: nothing is left to be
  // before, so the held «по» goes too.
  useEffect(() => {
    if (!period.startsFrom) setInvertedTo(null);
  }, [period.startsFrom]);
  const shownTo = invertedTo ?? period.startsTo;
  const changeFrom = (from: string) =>
    onChange((current) => {
      const to = invertedTo ?? current.startsTo;
      if (from && to && to < from) {
        setInvertedTo(to);
        return { startsFrom: from, startsTo: "" };
      }
      setInvertedTo(null);
      return { startsFrom: from, startsTo: to };
    });
  const changeTo = (to: string) =>
    onChange((current) => {
      if (current.startsFrom && to && to < current.startsFrom) {
        setInvertedTo(to);
        return { startsTo: "" };
      }
      setInvertedTo(null);
      return { startsTo: to };
    });
  const toErrorId = "events-period-to-error";

  return (
    <div
      role="group"
      aria-labelledby="events-period-label"
      className="flex min-w-0 flex-col gap-1.5"
    >
      <span
        id="events-period-label"
        className="text-xs font-bold leading-none text-foreground"
      >
        {t("events.list.period")}
      </span>
      {/* «с» and «по» stack full-width on a narrow screen — side by side they
          leave each date input too narrow for its own calendar icon. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="w-5 shrink-0 text-caption text-muted-foreground"
            aria-hidden="true"
          >
            {t("events.list.periodFrom")}
          </span>
          <Input
            type="date"
            className="min-w-0 flex-1"
            data-testid="events-period-from"
            aria-label={t("events.list.periodFromLabel")}
            value={period.startsFrom}
            onChange={(event) => changeFrom(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="w-5 shrink-0 text-caption text-muted-foreground"
              aria-hidden="true"
            >
              {t("events.list.periodTo")}
            </span>
            <Input
              type="date"
              className="min-w-0 flex-1"
              data-testid="events-period-to"
              aria-label={t("events.list.periodToLabel")}
              value={shownTo}
              aria-invalid={invertedTo !== null || undefined}
              aria-describedby={invertedTo !== null ? toErrorId : undefined}
              onChange={(event) => changeTo(event.target.value)}
            />
          </div>
          {invertedTo !== null ? (
            <FormError id={toErrorId} data-testid="events-period-inverted">
              {t("events.list.periodInverted")}
            </FormError>
          ) : null}
        </div>
      </div>
    </div>
  );
}

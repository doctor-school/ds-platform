import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  MonthCalendarGrid,
  MonthPicker,
  type DotGridCell,
  type MonthGridCell,
  type MonthPickerCell,
} from "@ds/design-system/blocks";
import { Container } from "@ds/design-system/container";
import { Link as DsLink } from "@ds/design-system/link";
import { fetchMonthBroadcasts, fetchMonthlyCounts } from "@/lib/public-events";
import {
  buildMonthGrid,
  capDayEntries,
  currentMskMonth,
  entryTime,
  formatAgendaDayTitle,
  formatMonthTitle,
  isMonthPast,
  monthShortLabels,
  shiftMonth,
  weekdayShortLabels,
} from "@/lib/month-grid";
import { MonthCalendarMobile, type AgendaDay } from "./month-calendar-mobile";
import { ViewSwitcher } from "./view-switcher";

/** The month-view URL for a `YYYY-MM` month (the ‹ › pager + picker link target). */
function monthViewHref(month: string): string {
  return `/webinars?view=month&month=${month}`;
}

/**
 * 004 EARS-19 — the «Месяц» pane of `/webinars` (`?view=month`, design §5.4). A
 * server component: it reads the current МСК month projection (`GET
 * /v1/public/events?month=`, uncached — a lifecycle transition surfaces on the
 * next request), folds every instant into `Europe/Moscow` via the pure
 * `month-grid` SSOT, and composes the `@ds/design-system` month-calendar blocks —
 * the desktop 7-column grid (≥901px) and the mobile dot-grid + selected-day
 * agenda (≤900px), the responsive split handled by the `layout:` breakpoint
 * (the token match for the canvas ≤900px fold) with NO client media query.
 *
 * The toolbar composes the canvas month controls (EARS-16/17/18, #1051): the ‹ ›
 * month pager + «Сегодня» reset + the 12-month `MonthPicker` disclosure (year ‹ ›
 * stepper + per-month counts) + the «Неделя / Месяц» switcher — all real
 * query-param links (server-component navigation, no client state, no mutation).
 * The switcher's «Неделя» link carries the displayed month so the week↔month
 * round-trip is loss-free.
 *
 * The displayed month is `month` (`YYYY-MM`, already validated by the page against
 * `MONTH_PARAM`); absent → the current МСК month. buildMonthGrid folds today/past
 * relative to МСК now, so a past/future month renders with no today marker.
 *
 * Copy: date/month/weekday PARTS are Intl-formatted МСК (the `msk.ts` EARS-12
 * precedent), every fixed LABEL comes from the typed catalog (`webinars.month`,
 * EARS-13) — no hardcoded RU in this component.
 */
export async function MonthCalendarView({ month }: { month?: string }) {
  const t = await getTranslations("webinars.month");

  const displayedMonth = month ?? currentMskMonth();
  const year = displayedMonth.slice(0, 4);
  const monthNum = Number(displayedMonth.slice(5, 7));
  const [entries, counts] = await Promise.all([
    fetchMonthBroadcasts(displayedMonth),
    fetchMonthlyCounts(year),
  ]);
  const grid = buildMonthGrid({ month: displayedMonth, entries });

  const weekdays = weekdayShortLabels();
  const monthTitle = formatMonthTitle(displayedMonth);

  // ── 12-month picker model (EARS-16): the displayed year's months + counts. ──
  const monthNames = monthShortLabels();
  const countByMonth = new Map(counts.map((c) => [c.month, c.count]));
  const pickerMonths: MonthPickerCell[] = monthNames.map((label, i) => {
    const m = i + 1;
    const monthStr = `${year}-${String(m).padStart(2, "0")}`;
    const current = m === monthNum;
    const past = isMonthPast(monthStr);
    return {
      label,
      note: past
        ? t("pickerPast")
        : t("pickerCount", { count: countByMonth.get(m) ?? 0 }),
      current,
      muted: past,
      href: current ? undefined : monthViewHref(monthStr),
    };
  });

  const prevMonth = shiftMonth(displayedMonth, -1);
  const nextMonth = shiftMonth(displayedMonth, 1);
  const schools = new Set(entries.map((e) => e.school)).size;
  const liveLabel = t("legendLive");
  const liveBadge = t("liveBadge");

  // ── Legend accent link (canvas line 155): always the NEXT month
  // (displayed + 1, year boundary via shiftMonth) — always-on regardless of
  // event data (owner rule on #1052 verdict #2). ──
  const nextMonthLink = {
    href: monthViewHref(nextMonth),
    label: t("nextMonthLink", { month: formatMonthTitle(nextMonth) }),
  };

  // ── Desktop grid model: pills for today/future, muted notes for past days. ──
  const desktopWeeks: MonthGridCell[][] = grid.weeks.map((week) =>
    week.map((cell): MonthGridCell => {
      if (!cell.inMonth) {
        return { dateLabel: String(cell.day), muted: true, mutedDate: true };
      }
      const hasEvents = cell.entries.length > 0;
      if (cell.isPast) {
        return {
          dateLabel: String(cell.day),
          muted: cell.isWeekend,
          mutedDate: true,
          note: hasEvents
            ? t("pastNote", { count: cell.entries.length })
            : undefined,
        };
      }
      const empty = !hasEvents;
      // Scope item 10 (canvas update 2026-07-17): ≤3 pills live-first; the
      // remainder folds into «+N ещё», anchored at the day's group in the week
      // listing (owner decision on #1065 — `/webinars?month=…#day-YYYY-MM-DD`,
      // the loss-free switcher round-trip param preserved).
      const { visible, overflow } = capDayEntries(cell.entries);
      return {
        dateLabel: cell.isToday ? `${cell.day}${t("todaySuffix")}` : String(cell.day),
        today: cell.isToday,
        // Owner rule (#1052 verdict #2): the muted BACKGROUND marks weekends
        // (and out-of-month filler above) ONLY — an empty weekday keeps the
        // card surface. The date INK keeps the canvas rule (past/weekend/empty).
        muted: cell.isWeekend,
        mutedDate: !cell.isToday && (cell.isWeekend || empty),
        pills: hasEvents
          ? visible.map((e) => ({
              href: `/webinars/${e.slug}`,
              time: entryTime(e),
              title: e.title,
              live: e.state === "live",
            }))
          : undefined,
        more:
          overflow > 0 && cell.isoDay
            ? {
                href: `/webinars?month=${displayedMonth}#day-${cell.isoDay}`,
                label: t("moreLink", { count: overflow }),
              }
            : undefined,
      };
    }),
  );

  // ── Mobile model: dot-grid cells + a per-day agenda map. ──
  const dotWeeks: DotGridCell[][] = grid.weeks.map((week) =>
    week.map((cell): DotGridCell => {
      const hasEvents = cell.entries.length > 0;
      const hasLive = cell.entries.some((e) => e.state === "live");
      const dots: DotGridCell["dots"] = !cell.inMonth
        ? []
        : cell.isPast
          ? hasEvents
            ? ["past"]
            : []
          : cell.entries
              .slice(0, 3)
              .map((e) => (e.state === "live" ? "live" : "event"));
      const ariaLabel =
        cell.inMonth && cell.isoDay
          ? [
              formatAgendaDayTitle(cell.isoDay),
              hasEvents ? t("dayEventsLabel", { count: cell.entries.length }) : null,
              hasLive ? t("dayLiveLabel") : null,
            ]
              .filter(Boolean)
              .join(", ")
          : String(cell.day);
      return {
        day: cell.day,
        inMonth: cell.inMonth,
        today: cell.isToday,
        dots,
        ariaLabel,
      };
    }),
  );

  const agendaDays: Record<number, AgendaDay> = {};
  for (const cell of grid.weeks.flat()) {
    if (!cell.inMonth || !cell.isoDay) continue;
    agendaDays[cell.day] = {
      title: `${formatAgendaDayTitle(cell.isoDay)}${cell.isToday ? t("todaySuffix") : ""}`,
      emptyText: cell.isPast ? t("agendaEmptyPast") : t("agendaEmptyFuture"),
      rows: cell.entries.map((e) => ({
        href: `/webinars/${e.slug}`,
        time: entryTime(e),
        school: e.school,
        title: e.title,
        live: e.state === "live",
        liveLabel: liveBadge,
      })),
    };
  }

  const defaultDay = grid.todayDom ?? grid.weeks.flat().find((c) => c.inMonth)?.day ?? 1;

  const tw = await getTranslations("webinars");

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Poster hero — canvas lines 32–40: the `hero` band (blue.500 light /
          blue.700 dark), NO kicker, h1 + subtitle left, the uppercase tagline
          bottom-right; deep bottom padding so the pulled-up toolbar sits ON the
          band (line 289: mainTop −60px desktop). */}
      <header className="bg-hero text-hero-foreground">
        <Container
          variant="calendar"
          className="flex flex-wrap items-end justify-between gap-8 pt-8 pb-10 layout:pt-10 layout:pb-25"
        >
          <div>
            <h1 className="text-3xl leading-none font-extrabold tracking-tight text-balance layout:text-4xl">
              {monthTitle}
            </h1>
            <p
              className="mt-4 text-body-compact font-semibold text-hero-muted"
              data-testid="poster-decor"
            >
              {t("subtitle", { count: entries.length, schools })}
            </p>
          </div>
          <div
            className="pb-1.5 text-xs leading-loose font-extrabold uppercase tracking-micro text-hero-muted"
            data-testid="poster-decor"
          >
            {tw("taglineTop")}
            <br />
            <span className="text-hero-foreground">{tw("taglineBottom")}</span>
          </div>
        </Container>
      </header>

      <Container
        variant="calendar"
        className="relative z-10 mt-6 pb-16 layout:-mt-15 layout:pb-24"
      >
        {/* Month toolbar (EARS-16/17/18): picker + ‹ › pager + «Сегодня» +
            «Неделя / Месяц» switcher — all query-param links, no client state.
            Mobile (canvas lines 47–61): the picker stretches, «Сегодня» and the
            boxed switcher yield to the «← Неделя» / «Месяц» text row below. */}
        <div
          className="flex flex-wrap items-stretch gap-2.5 layout:gap-3"
          data-testid="month-toolbar"
        >
          <MonthPicker
            className="min-w-0 flex-1 layout:flex-none"
            triggerLabel={monthTitle}
            pickerLabel={t("pickerLabel")}
            year={year}
            prevYearHref={monthViewHref(shiftMonth(displayedMonth, -12))}
            nextYearHref={monthViewHref(shiftMonth(displayedMonth, 12))}
            prevYearLabel={t("prevYear")}
            nextYearLabel={t("nextYear")}
            months={pickerMonths}
          />

          <DsLink
            asChild
            className="inline-flex items-center border-2 border-border bg-card px-4 text-base font-extrabold text-foreground shadow-sm"
          >
            <Link href={monthViewHref(prevMonth)} aria-label={t("prevMonth")}>
              <span aria-hidden="true">‹</span>
            </Link>
          </DsLink>
          <DsLink
            asChild
            className="inline-flex items-center border-2 border-border bg-card px-4 text-base font-extrabold text-foreground shadow-sm"
          >
            <Link href={monthViewHref(nextMonth)} aria-label={t("nextMonth")}>
              <span aria-hidden="true">›</span>
            </Link>
          </DsLink>

          <DsLink
            asChild
            className="hidden items-center border-2 border-border bg-card px-5 text-caption font-bold text-tint-foreground shadow-sm layout:inline-flex"
          >
            <Link href="/webinars?view=month">{t("todayButton")}</Link>
          </DsLink>

          <span className="hidden flex-1 layout:block" />

          <div className="hidden layout:block">
            <ViewSwitcher
              active="month"
              weekHref={`/webinars?month=${displayedMonth}`}
              monthHref={monthViewHref(displayedMonth)}
              weekLabel={t("viewWeek")}
              monthLabel={t("viewMonth")}
            />
          </div>
        </div>

        {/* Mobile view-switch text row — canvas lines 58–61: «← Неделя» link
            left, the active «Месяц» label right. */}
        <div className="mt-3 flex items-center justify-between layout:hidden">
          <DsLink
            asChild
            variant="inline"
            className="text-caption font-bold text-tint-foreground"
          >
            <Link href={`/webinars?month=${displayedMonth}`}>
              <span aria-hidden="true">← </span>
              {t("viewWeek")}
            </Link>
          </DsLink>
          <span
            aria-current="page"
            className="text-caption font-extrabold text-tint-foreground"
          >
            {t("viewMonth")}
          </span>
        </div>

        {/* Desktop pane (≥901px). */}
        <MonthCalendarGrid
          className="hidden layout:block"
          data-testid="month-grid-desktop"
          weekdays={weekdays}
          weeks={desktopWeeks}
          liveLabel={liveLabel}
          legend={{
            live: t("legendLive"),
            planned: t("legendPlanned"),
            past: t("legendPast"),
          }}
          nextMonthLink={nextMonthLink}
        />

        {/* Mobile pane (≤900px). */}
        <MonthCalendarMobile
          className="layout:hidden"
          weekdays={weekdays}
          weeks={dotWeeks}
          days={agendaDays}
          defaultDay={defaultDay}
        />
      </Container>
    </main>
  );
}

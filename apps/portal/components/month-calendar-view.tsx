import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  MonthCalendarGrid,
  MonthPicker,
  type DotGridCell,
  type MonthGridCell,
  type MonthPickerCell,
  type MonthPickerYear,
} from "@ds/design-system/blocks";
import { Button } from "@ds/design-system/button";
import { Link as DsLink } from "@ds/design-system/link";
import { fetchMonthBroadcasts, fetchMonthlyCounts } from "@/lib/public-events";
import {
  buildMonthGrid,
  capDayEntries,
  currentMskMonth,
  entryTime,
  formatAgendaDayTitle,
  formatMonthTitle,
  isMonthFuture,
  isMonthPast,
  monthShortLabels,
  shiftMonth,
  weekdayShortLabels,
} from "@/lib/month-grid";
import { CalendarShell } from "./calendar-shell";
import { MonthCalendarMobile, type AgendaDay } from "./month-calendar-mobile";
import { ViewSwitcher } from "./view-switcher";

/** The month-view URL for a `YYYY-MM` month (the ‹ › pager + picker link target). */
function monthViewHref(month: string): string {
  return `/webinars?view=month&month=${month}`;
}

/**
 * The picker's in-place year-paging window (004 owner verdict #4 on #1052): the
 * displayed year ± 1 (three years). The picker pages these client-side with NO
 * navigation — the popover stays open, the counters swap; a step PAST the window
 * edge server-navigates a whole year (`prev/nextYearHref`), re-centring the window.
 * The bound is deliberate: real scheduling lives within ~a year of now, so three
 * pre-fetched years cover every instant-swap case while capping the render to
 * three count reads instead of an unbounded fan-out.
 */
const PICKER_YEAR_RADIUS = 1;

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
 * The pane renders through the shared `CalendarShell` (004 owner verdict #3): the
 * «Неделя» and «Месяц» panes share one navy hero + one 1240px content column, so
 * a «Неделя ⇄ Месяц» round-trip never jumps the header band or the column edges.
 *
 * The toolbar composes the canvas month controls (EARS-16/17/18, #1051): the ‹ ›
 * month pager + «Сегодня» reset + the 12-month `MonthPicker` disclosure (year ‹ ›
 * stepper + per-month counts) + the «Неделя / Месяц» switcher. The pager/«Сегодня»
 * adopt the DS `Button` `outline` states (hover / active-press / focus-visible) so
 * the toolbar reads as white bordered controls on the navy hero (owner verdicts
 * #1/#2), never hand-assembled anchors. The picker's year paging is the one piece
 * of client state; every other control is a real query-param link.
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

  // ── The picker's year window: displayed year ± PICKER_YEAR_RADIUS. ──
  const yearNum = Number(year);
  const windowYears = Array.from(
    { length: PICKER_YEAR_RADIUS * 2 + 1 },
    (_, i) => String(yearNum - PICKER_YEAR_RADIUS + i),
  );

  const [entries, countsByYear] = await Promise.all([
    fetchMonthBroadcasts(displayedMonth),
    // One count read per window year; a bad/empty far year degrades to zeros
    // rather than taking the pane down (the displayed year is always real).
    Promise.all(
      windowYears.map(
        async (y) => [y, await fetchMonthlyCounts(y).catch(() => [])] as const,
      ),
    ),
  ]);

  const grid = buildMonthGrid({ month: displayedMonth, entries });

  const weekdays = weekdayShortLabels();
  const monthTitle = formatMonthTitle(displayedMonth);

  // ── 12-month picker model (EARS-16): every window year's months + counts.
  //    Only the displayed year's displayed month is the filled «you are here». ──
  const monthNames = monthShortLabels();
  const pickerYears: MonthPickerYear[] = countsByYear.map(([y, counts]) => {
    const countByMonth = new Map(counts.map((c) => [c.month, c.count]));
    const months: MonthPickerCell[] = monthNames.map((label, i) => {
      const m = i + 1;
      const monthStr = `${y}-${String(m).padStart(2, "0")}`;
      const current = y === year && m === monthNum;
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
    return { year: y, months };
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

  // ── Return-from-future link (owner verdict #5): the «← <prev month>» back link
  // renders ONLY when the displayed month is strictly in the future; the current
  // or a past month withholds it (never motivate backward browsing). ──
  const prevMonthLink = isMonthFuture(displayedMonth)
    ? {
        href: monthViewHref(prevMonth),
        label: t("prevMonthLink", { month: formatMonthTitle(prevMonth) }),
      }
    : undefined;

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

  // ── Toolbar (EARS-16/17/18): picker + ‹ › pager + «Сегодня» + switcher. The
  // picker holds the year-paging client state; the pager/«Сегодня» are Button
  // `outline` query-param links; the switcher sits at the same right-aligned
  // position both panes share. Mobile: the picker stretches, «Сегодня»/switcher
  // yield to the «← Неделя» / «Месяц» text row below. ──
  const toolbar = (
    <>
      <div
        className="flex flex-wrap items-stretch gap-2.5 layout:gap-3"
        data-testid="month-toolbar"
      >
        <MonthPicker
          className="min-w-0 flex-1 layout:flex-none"
          triggerLabel={monthTitle}
          pickerLabel={t("pickerLabel")}
          initialYear={year}
          years={pickerYears}
          prevYearHref={monthViewHref(shiftMonth(displayedMonth, -12))}
          nextYearHref={monthViewHref(shiftMonth(displayedMonth, 12))}
          prevYearLabel={t("prevYear")}
          nextYearLabel={t("nextYear")}
        />

        <Button asChild variant="outline" className="px-4 text-base font-extrabold">
          <Link href={monthViewHref(prevMonth)} aria-label={t("prevMonth")}>
            <span aria-hidden="true">‹</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="px-4 text-base font-extrabold">
          <Link href={monthViewHref(nextMonth)} aria-label={t("nextMonth")}>
            <span aria-hidden="true">›</span>
          </Link>
        </Button>

        <Button
          asChild
          variant="outline"
          className="hidden px-5 text-caption text-tint-foreground layout:inline-flex"
        >
          <Link href="/webinars?view=month">{t("todayButton")}</Link>
        </Button>

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

      {/* Mobile view-switch text row — canvas lines 58–61: «← Неделя» link left,
          the active «Месяц» label right. */}
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
    </>
  );

  return (
    <CalendarShell
      title={monthTitle}
      subtitle={t("subtitle", { count: entries.length, schools })}
      taglineTop={tw("taglineTop")}
      taglineBottom={tw("taglineBottom")}
      toolbar={toolbar}
    >
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
        prevMonthLink={prevMonthLink}
      />

      {/* Mobile pane (≤900px). */}
      <MonthCalendarMobile
        className="layout:hidden"
        weekdays={weekdays}
        weeks={dotWeeks}
        days={agendaDays}
        defaultDay={defaultDay}
      />
    </CalendarShell>
  );
}

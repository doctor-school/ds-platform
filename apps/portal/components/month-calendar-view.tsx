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
      return {
        dateLabel: cell.isToday ? `${cell.day}${t("todaySuffix")}` : String(cell.day),
        today: cell.isToday,
        muted: cell.isWeekend || empty,
        mutedDate: !cell.isToday && (cell.isWeekend || empty),
        pills: hasEvents
          ? cell.entries.map((e) => ({
              href: `/webinars/${e.slug}`,
              time: entryTime(e),
              title: e.title,
              live: e.state === "live",
            }))
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          <p
            className="text-2xs font-extrabold uppercase tracking-micro opacity-80"
            data-testid="poster-decor"
          >
            {t("viewMonth")}
          </p>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
            {monthTitle}
          </h1>
          <p
            className="mt-4 text-caption font-semibold opacity-90"
            data-testid="poster-decor"
          >
            {t("subtitle", { count: entries.length, schools })}
          </p>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
        {/* Month toolbar (EARS-16/17/18): picker + ‹ › pager + «Сегодня» +
            «Неделя / Месяц» switcher — all query-param links, no client state. */}
        <div
          className="mb-8 flex flex-wrap items-stretch gap-3"
          data-testid="month-toolbar"
        >
          <MonthPicker
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
            className="inline-flex items-center border-2 border-border bg-card px-5 text-caption font-bold text-tint-foreground shadow-sm"
          >
            <Link href="/webinars?view=month">{t("todayButton")}</Link>
          </DsLink>

          <span className="flex-1" />

          <ViewSwitcher
            active="month"
            weekHref={`/webinars?month=${displayedMonth}`}
            monthHref={monthViewHref(displayedMonth)}
            weekLabel={t("viewWeek")}
            monthLabel={t("viewMonth")}
          />
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

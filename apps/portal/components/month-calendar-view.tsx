import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  MonthCalendarGrid,
  type DotGridCell,
  type MonthGridCell,
} from "@ds/design-system/blocks";
import { Container } from "@ds/design-system/container";
import { Link as DsLink } from "@ds/design-system/link";
import { fetchMonthBroadcasts } from "@/lib/public-events";
import {
  buildMonthGrid,
  currentMskMonth,
  entryTime,
  formatAgendaDayTitle,
  formatMonthTitle,
  weekdayShortLabels,
} from "@/lib/month-grid";
import { MonthCalendarMobile, type AgendaDay } from "./month-calendar-mobile";

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
 * The switcher renders the canvas «Неделя / Месяц» toggle as real links
 * («Неделя» → the week listing, «Месяц» the active pane) — never a dead CTA. The
 * ‹ › month paging, the 12-month picker interaction, and their EARS-17/18 tests
 * are the sibling slice #1051; only the toggle LOOK is in scope here.
 *
 * Copy: date/month/weekday PARTS are Intl-formatted МСК (the `msk.ts` EARS-12
 * precedent), every fixed LABEL comes from the typed catalog (`webinars.month`,
 * EARS-13) — no hardcoded RU in this component.
 */
export async function MonthCalendarView() {
  const t = await getTranslations("webinars.month");

  const month = currentMskMonth();
  const entries = await fetchMonthBroadcasts(month);
  const grid = buildMonthGrid({ month, entries });

  const weekdays = weekdayShortLabels();
  const monthTitle = formatMonthTitle(month);
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
        {/* «Неделя / Месяц» switcher — real links, never a dead CTA (#1051 owns
            the ‹ › paging + 12-month picker interactions). */}
        <div
          className="mb-8 flex justify-end"
          data-testid="view-switcher"
        >
          <div className="inline-grid grid-cols-2 border-2 border-border bg-card shadow-sm">
            <DsLink
              asChild
              className="inline-flex items-center px-4.5 py-2.5 text-caption font-bold text-tint-foreground"
            >
              <Link href="/webinars">{t("viewWeek")}</Link>
            </DsLink>
            <span
              aria-current="page"
              className="inline-flex items-center border-l-2 border-border bg-primary-action px-4.5 py-2.5 text-caption font-extrabold text-primary-foreground"
            >
              {t("viewMonth")}
            </span>
          </div>
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

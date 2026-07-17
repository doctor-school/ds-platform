import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { UpcomingBroadcastCard } from "@ds/schemas";
import { Container } from "@ds/design-system/container";
import { DayBand } from "@ds/design-system/day-band";
import { WebinarCard } from "@ds/design-system/webinar-card";
import { fetchUpcomingBroadcasts } from "@/lib/public-events";
import { fetchMyEvents } from "@/lib/my-events";
import {
  formatMskDayLabel,
  formatMskParts,
  formatMskWeekdayShort,
  mskDayKey,
} from "@/lib/msk";
import { ViewSwitcher } from "./view-switcher";

/**
 * 004 EARS-7 / 008 EARS-8 — the public upcoming-broadcasts listing, the shared
 * discovery front-door surface. Extracted from `app/webinars/page.tsx` in #982 so
 * BOTH `/` (the canonical front-door + post-login landing, EARS-7/8/9) and the
 * existing `/webinars` route render the identical listing from one source; the
 * surface renders identically for a guest and a logged-in doctor (EARS-8 does not
 * branch on auth). `export const dynamic = "force-dynamic"` cannot live on a
 * component — each page that renders this re-declares it.
 *
 * Reads the `UpcomingBroadcastCard[]` projection (published/live, nearest air date
 * first) and lays it out as the §09 day-grouped rhythm built to
 * `webinars-listing.dc.html`: a blue poster header, then per-МСК-day groups (a
 * full-bleed `DayBand` on mobile, a label + 2px ink rule on desktop) of cards.
 * When the projection is empty the canvas empty-state renders instead of a blank
 * surface (EARS-11).
 *
 * Wave-1 minimal cut (requirements Scope): the vendored canvas also carries a
 * specialty filter, week-paging, a «Неделя / Месяц» switch and a month view —
 * those are wave 2 and are intentionally NOT built here. Each card is the full
 * `webinar-card.dc.html` unit (the `@ds/design-system` `WebinarCard` primitive):
 * the tinted time plate (МСК + day·weekday), school kicker, title, specialty
 * chips, and speakers, linking to its event page (EARS-8). The card's own CTA
 * row belongs to the event PAGE (EARS-3), so on the listing the whole card is
 * the single link affordance instead.
 */

interface DayGroup {
  key: string;
  label: string;
  cards: UpcomingBroadcastCard[];
}

/** Group the already-nearest-first cards by their Europe/Moscow calendar day, preserving order. */
function groupByDay(cards: UpcomingBroadcastCard[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const card of cards) {
    const key = mskDayKey(card.startsAt);
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.cards.push(card);
    } else {
      groups.push({ key, label: formatMskDayLabel(card.startsAt), cards: [card] });
    }
  }
  return groups;
}

/**
 * The viewer's own registered-event slugs (004 EARS-8 registered marker, owner
 * decision on #559): composed in the PORTAL layer from the 005 `MyEvents` read —
 * the public `UpcomingBroadcastCard` projection stays publish-safe (EARS-10, no
 * per-user field on the public endpoint). A guest (no session cookie) issues no
 * read and gets the unchanged public render; the marker is a per-viewer overlay
 * enhancement, so a failed read degrades to the public render instead of taking
 * the PUBLIC listing down with it.
 */
async function fetchRegisteredSlugs(): Promise<ReadonlySet<string>> {
  const h = await headers();
  try {
    const result = await fetchMyEvents({
      cookie: h.get("cookie") ?? "",
      // The session is fingerprint-bound (ADR-0001 §6) — forward the same
      // surface the browser bound at login (mirrors the event page's read).
      userAgent: h.get("user-agent") ?? "",
      acceptLanguage: h.get("accept-language") ?? "",
    });
    return new Set(
      result.authenticated ? result.events.map((e) => e.slug) : [],
    );
  } catch {
    // Per-viewer overlay only — never fail the public listing over it.
    return new Set();
  }
}

/**
 * `monthViewHref` — when the `/webinars` route renders this pane it passes the
 * month-view target (carrying any active month) so the «Неделя / Месяц» switcher
 * renders (EARS-18); the `/` front-door renders the listing with NO switcher
 * (omitted). The «Неделя» side is the active pane here.
 */
export default async function DiscoveryListing({
  monthViewHref,
}: {
  monthViewHref?: string;
} = {}) {
  const t = await getTranslations("webinars");
  const [cards, registeredSlugs] = await Promise.all([
    fetchUpcomingBroadcasts(),
    fetchRegisteredSlugs(),
  ]);
  const groups = groupByDay(cards);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Poster hero — `webinars-listing.dc.html` lines 42–49 (#1065 item 6:
          the hero is shared with the month view): the `hero` band (blue.500
          light / blue.700 dark), NO kicker, h1 + subtitle left, the uppercase
          tagline bottom-right. */}
      <header className="bg-hero text-hero-foreground">
        <Container className="flex flex-wrap items-end justify-between gap-8 py-10 layout:py-12">
          <div>
            <h1 className="text-3xl leading-none font-extrabold tracking-tight text-balance layout:text-4xl">
              {t("title")}
            </h1>
            <p
              className="mt-4 text-body-compact font-semibold text-hero-muted"
              data-testid="poster-decor"
            >
              {t("subtitle")}
            </p>
          </div>
          <div
            className="pb-1.5 text-xs leading-loose font-extrabold uppercase tracking-micro text-hero-muted"
            data-testid="poster-decor"
          >
            {t("taglineTop")}
            <br />
            <span className="text-hero-foreground">{t("taglineBottom")}</span>
          </div>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
        {monthViewHref ? (
          <div className="mb-8 flex justify-end">
            <ViewSwitcher
              active="week"
              weekHref="/webinars"
              monthHref={monthViewHref}
              weekLabel={t("month.viewWeek")}
              monthLabel={t("month.viewMonth")}
            />
          </div>
        ) : null}

        {groups.length === 0 ? (
          <div className="border-2 border-dashed border-border px-6 py-14 text-center layout:py-20">
            <p className="text-lg font-extrabold tracking-tight">
              {t("empty.title")}
            </p>
            <p className="mx-auto mt-2 max-w-md text-caption leading-relaxed text-muted-foreground">
              {t("empty.body")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8 layout:gap-12">
            {groups.map((group) => (
              // `id="day-YYYY-MM-DD"` — the month grid's «+N ещё» overflow link
              // targets this day's group (#1065 item 10, owner decision:
              // `/webinars?month=…#day-YYYY-MM-DD`, anchors only).
              <section key={group.key} id={`day-${group.key}`}>
                {/* Mobile: full-bleed day band; desktop: label + 2px ink rule. */}
                <DayBand className="-mx-4 layout:hidden">{group.label}</DayBand>
                <div className="hidden layout:mb-6 layout:flex layout:items-baseline layout:gap-4">
                  <span className="text-caption font-extrabold uppercase tracking-micro whitespace-nowrap">
                    {group.label}
                  </span>
                  <span className="flex-1 border-t-2 border-foreground" />
                </div>

                <div className="-mx-4 flex flex-col layout:mx-0 layout:gap-7">
                  {group.cards.map((card) => {
                    const parts = formatMskParts(card.startsAt);
                    return (
                      <WebinarCard
                        key={card.id}
                        href={`/webinars/${card.slug}`}
                        time={parts.time}
                        tzLabel={t("cardTz")}
                        dateLabel={t("cardDate", {
                          date: parts.date,
                          weekday: formatMskWeekdayShort(card.startsAt),
                        })}
                        school={card.school}
                        title={card.title}
                        specialties={card.specialties}
                        speakers={card.speakers}
                        live={card.state === "live"}
                        liveLabel={t("live")}
                        registered={registeredSlugs.has(card.slug)}
                        registeredLabel={t("registered")}
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}

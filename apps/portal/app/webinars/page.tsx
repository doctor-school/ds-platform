import { getTranslations } from "next-intl/server";
import type { UpcomingBroadcastCard } from "@ds/schemas";
import { Container } from "@ds/design-system/container";
import { DayBand } from "@ds/design-system/day-band";
import { WebinarCard } from "@ds/design-system/webinar-card";
import { fetchUpcomingBroadcasts } from "../../lib/public-events";
import {
  formatMskDayLabel,
  formatMskParts,
  formatMskWeekdayShort,
  mskDayKey,
} from "../../lib/msk";

/**
 * 004 EARS-7 — the public upcoming-broadcasts listing, server-rendered at
 * `/webinars`. Reads the `UpcomingBroadcastCard[]` projection (published/live,
 * nearest air date first) and lays it out as the §09 day-grouped rhythm built to
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
 *
 * Rendered per request (`force-dynamic`) — a lifecycle transition can add/remove
 * a card, so a static prerender would go stale.
 */
export const dynamic = "force-dynamic";

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

export default async function WebinarsListingPage() {
  const t = await getTranslations("webinars");
  const cards = await fetchUpcomingBroadcasts();
  const groups = groupByDay(cards);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          <p className="text-2xs font-extrabold uppercase tracking-micro opacity-80">
            {t("breadcrumb")}
          </p>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-4 text-caption font-semibold opacity-90">
            {t("subtitle")}
          </p>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
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
              <section key={group.key}>
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

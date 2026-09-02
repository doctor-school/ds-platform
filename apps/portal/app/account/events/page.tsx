import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { MyEventsTab } from "@ds/schemas";
import { Container } from "@ds/design-system/container";
import { buildMyEventListItems, fetchMyEvents } from "../../../lib/my-events";
import { EventListRouter } from "../../../components/event-list-router";

/**
 * 005 EARS-6 + 014 EARS-9 — the «Мои события» account surface
 * (`my-events.dc.html`), server-rendered at `/account/events`. It carries exactly
 * TWO tabs, **Предстоящие** (default) and **Записи**, over the doctor's FULL
 * registration history:
 *
 *   • **Предстоящие** — the registered `published`/`live` events (future or
 *     currently airing), day-grouped, NEAREST first, each linking back to its
 *     event page and admitting the doctor into a live room (006 EARS-6);
 *   • **Записи** — every registered `ended` event, month-grouped, newest first,
 *     each badged with its recording state. An ended event whose recording is not
 *     published yet still appears, carrying the «Запись готовится» badge, so a
 *     doctor never loses an эфир they attended. `hidden` events appear in
 *     NEITHER tab.
 *
 * Each tab is one `GET /v1/me/events?tab=…` read; the envelope carries BOTH tabs'
 * counts, so the un-selected tab's chip is right without a second read. The tab is
 * explicit URL state (`?tab=recordings`) — the surface is deep-linkable and the
 * browser's back button walks the tabs (014-design §8.3).
 *
 * `MyEvents` is a `doctor_guest`-authenticated read (EARS-10) — a SEPARATE authed
 * read (`lib/my-events`) forwarding the request's session cookie + fingerprint
 * headers; a guest (no/expired session) is redirected to login (the surface is
 * authenticated, unlike the public 004 pages). The read returns ONLY the caller's
 * own registrations, never another doctor's.
 *
 * The listing renders through the SHARED `EventList` block (#1346) by way of the
 * portal's one `EventListRouter` projection — the same unit the public `/webinars`
 * feed uses, never a section-local copy (AGENTS.md cross-front reuse). Only the
 * route, the `?tab=` value and the copy differ.
 *
 * Deviations from the vendored canvas:
 *   • the canvas's third **Сертификаты** tab is a review miss and is owner-decided
 *     out of scope (2026-08-17) — it is not built, and no placeholder or disabled
 *     stub is rendered;
 *   • the canvas's **«Направление»** specialty filter is a Wave-1 cut, deferred to
 *     014 EARS-12 / EARS-14 (the `facets` wave) — it lands with that wave, not here;
 *   • the canvas's «Доступно 30 дней после эфира» band and its «Показать все N
 *     записей» link are superseded by 014-design §8.3: «Записи» is the FULL history
 *     with no retention window and no truncation, so neither is built.
 *
 * Rendered per request (`force-dynamic`) — a per-user read whose lifecycle state /
 * membership can change; a static prerender would go stale, and a just-registered
 * event must appear on the next read (EARS-7).
 */
export const dynamic = "force-dynamic";

/** `?tab=recordings` selects «Записи»; anything else is the default «Предстоящие». */
function resolveTab(raw: string | string[] | undefined): MyEventsTab {
  return raw === "recordings" ? "recordings" : "upcoming";
}

export default async function MyEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("myEvents");
  // 006 EARS-6 — the room-entry CTA copy («Войти в эфир») is the SAME catalog key
  // the event-page enter-room CTA uses (`webinar.registered.live.cta`), reused
  // verbatim so «Мои события» never carries a hardcoded or divergent string.
  const tWebinar = await getTranslations("webinar");
  const tab = resolveTab((await searchParams).tab);
  const h = await headers();
  const result = await fetchMyEvents(
    {
      cookie: h.get("cookie") ?? "",
      // The session is fingerprint-bound (ADR-0001 §6) — forward the same surface
      // the browser bound at login so the authed read is not 401'd (see the lib).
      userAgent: h.get("user-agent") ?? "",
      acceptLanguage: h.get("accept-language") ?? "",
    },
    tab,
  );
  // Authenticated surface: a guest / expired session goes to login (never a blank
  // or public render, unlike the 004 public pages).
  if (!result.authenticated) redirect("/login");

  const { data, counts } = result.events;
  const recordings = tab === "recordings";
  const items = buildMyEventListItems(data, tab, {
    cardTz: t("cardTz"),
    dateLabel: ({ date, weekday }) => t("cardDate", { date, weekday }),
    live: t("live"),
    recordingLabel: (state) => t(`recording.${state}`),
    recordingCta: t("recordingCta"),
    roomCta: tWebinar("registered.live.cta"),
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          <div className="flex items-end justify-between gap-8">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
                {t("title")}
              </h1>
              <p
                className="mt-4 text-caption font-semibold opacity-90"
                data-testid="poster-decor"
              >
                {recordings
                  ? t("recordingsSubtitle", { count: counts.recordings })
                  : t("subtitle", { count: counts.upcoming })}
              </p>
            </div>
            {/* Timezone block (EARS-11): «Мои события» presents every instant in
                Europe/Moscow (МСК), never the viewer's local timezone. The whole
                block renders at `opacity-80` (the inner `opacity-100` cannot lift
                a parent opacity group), so it is decorative-poster contrast debt. */}
            <div
              className="hidden shrink-0 text-right text-2xs font-extrabold uppercase tracking-micro leading-loose opacity-80 layout:block"
              data-testid="poster-decor"
            >
              {t("tzEyebrow")}
              <br />
              <span className="opacity-100">{t("tzValue")}</span>
            </div>
          </div>
        </Container>
      </header>

      <Container className="py-10 layout:py-14">
        {/* `MyEvents` returns a whole tab at once — no paging; `pageCount = 1`
            makes the shared `Pagination` block render nothing at all. */}
        <EventListRouter
          basePath="/account/events"
          pastTabParam="recordings"
          items={items}
          selectedTab={recordings ? "past" : "upcoming"}
          counts={{ upcoming: counts.upcoming, past: counts.recordings }}
          labels={{
            upcoming: t("tabs.upcoming"),
            past: t("tabs.recordings"),
            emptyTitle: t(
              recordings ? "recordingsEmpty.title" : "empty.title",
            ),
            emptyDescription: t(
              recordings ? "recordingsEmpty.body" : "empty.body",
            ),
            pagination: t("pagination.label"),
            previous: t("pagination.previous"),
            next: t("pagination.next"),
            pagePrefix: t("pagination.page"),
          }}
          paginationMode="pages"
          pageCount={1}
          page={1}
          nextCursor={null}
          hasMore={false}
        />
      </Container>
    </main>
  );
}

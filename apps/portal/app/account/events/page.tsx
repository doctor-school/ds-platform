import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Container } from "@ds/design-system/container";
import { DayBand } from "@ds/design-system/day-band";
import { WebinarCard } from "@ds/design-system/webinar-card";
import { fetchMyEvents, groupMyEventsByDay } from "../../../lib/my-events";
import { toCanvasStatus } from "../../../lib/event-lifecycle";
import { resolveRoomEntryHref } from "../../../lib/registration-state";
import {
  formatMskParts,
  formatMskWeekdayShort,
} from "../../../lib/msk";

/**
 * 005 EARS-6 — the «мои события» account surface (the **Предстоящие** tab of
 * `my-events.dc.html`), server-rendered at `/account/events`. It lists the
 * authenticated doctor's registered UPCOMING events (`published`/`live`, future or
 * currently airing), day-grouped, nearest first, each carrying date/time (МСК,
 * EARS-11), title, school, and a link back to its event page (`/webinars/:slug`) —
 * closing the legacy "registered but can't find it" gap. When the `MyEvents` read
 * is `[]` the canvas empty-state renders instead of a blank surface (EARS-6/EARS-12).
 *
 * `MyEvents` is a `doctor_guest`-authenticated read (EARS-10) — a SEPARATE authed
 * read (`lib/my-events`) forwarding the request's session cookie + fingerprint
 * headers; a guest (no/expired session) is redirected to login (the surface is
 * authenticated, unlike the public 004 pages). The read returns ONLY the caller's
 * own registrations, never another doctor's.
 *
 * Wave-1 cut (requirements Scope, design §6.2): the vendored canvas also carries
 * **Записи** / **Сертификаты** tabs and a specialty filter — those are wave 2+ and
 * are intentionally NOT built here (named deferral), and no dead tab stubs are
 * rendered. Only the Предстоящие content + the day-grouped card rhythm are in
 * scope. Each row is the `webinar-card.dc.html` unit (the `@ds/design-system`
 * `WebinarCard` primitive graduated in 004), reused verbatim; the `MyEvents`
 * projection is thinner than the public card (no specialties/speakers), so the
 * card omits those rows.
 *
 * Rendered per request (`force-dynamic`) — a per-user read whose lifecycle state /
 * membership can change; a static prerender would go stale, and a just-registered
 * event must appear on the next read (EARS-7).
 */
export const dynamic = "force-dynamic";

export default async function MyEventsPage() {
  const t = await getTranslations("myEvents");
  // 006 EARS-6 — the room-entry CTA copy («Войти в эфир») is the SAME catalog key
  // the event-page enter-room CTA uses (`webinar.registered.live.cta`), reused
  // verbatim so «мои события» never carries a hardcoded or divergent string.
  const tWebinar = await getTranslations("webinar");
  const h = await headers();
  const result = await fetchMyEvents({
    cookie: h.get("cookie") ?? "",
    // The session is fingerprint-bound (ADR-0001 §6) — forward the same surface
    // the browser bound at login so the authed read is not 401'd (see the lib).
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });
  // Authenticated surface: a guest / expired session goes to login (never a blank
  // or public render, unlike the 004 public pages).
  if (!result.authenticated) redirect("/login");

  const groups = groupMyEventsByDay(result.events);
  const count = result.events.length;

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
                {t("subtitle", { count })}
              </p>
            </div>
            {/* Timezone block (EARS-11): «мои события» presents every instant in
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
                  {group.events.map((event) => {
                    const parts = formatMskParts(event.startsAt);
                    // 006 EARS-6 — every «мои события» row is one of the caller's
                    // OWN registrations (the read returns only registered events),
                    // so a `live` row admits the doctor into the room. Reuse the
                    // hardened `resolveRoomEntryHref` (with the known-registered
                    // state) so the room path is built through the same open-
                    // redirect defence as the event-page CTA — non-null only for a
                    // `live` event, `null` otherwise (no CTA renders).
                    const roomEntryHref = resolveRoomEntryHref(
                      { registered: true },
                      toCanvasStatus(event.state),
                      event.slug,
                    );
                    return (
                      <WebinarCard
                        key={event.eventId}
                        href={`/webinars/${event.slug}`}
                        time={parts.time}
                        tzLabel={t("cardTz")}
                        dateLabel={t("cardDate", {
                          date: parts.date,
                          weekday: formatMskWeekdayShort(event.startsAt),
                        })}
                        school={event.school}
                        title={event.title}
                        live={event.state === "live"}
                        liveLabel={t("live")}
                        ctaHref={roomEntryHref ?? undefined}
                        ctaLabel={
                          roomEntryHref
                            ? tWebinar("registered.live.cta")
                            : undefined
                        }
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

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@ds/design-system/badge";
import { Container } from "@ds/design-system/container";
import { WebinarPageContent } from "@ds/design-system/webinar-page-content";
import { fetchPublicEventPage } from "../../../lib/public-events";
import { formatMskParts } from "../../../lib/msk";

/**
 * 004 EARS-1 — the public webinar event page, server-rendered. A
 * sponsor-distributed link (`/webinars/:slug`) resolves to complete HTML for an
 * UNAUTHENTICATED recipient: no cookie is read, no client soft-wall, no gated
 * section (the retired legacy "авторизуйтесь для просмотра" overlay is a banned
 * pattern — 004 design §1). The poster header carries the school kicker, the
 * title, the target specialty chips, the МСК start time, and the lifecycle-state
 * badge; the two-column body below it is the complete decision set from the
 * `PublicEventPage` projection — description, program PDF, backing partners, and
 * speakers — laid out to `webinar-page.dc.html` via the `WebinarPageContent`
 * design-system primitive (EARS-2). The «Участвовать» CTA / status card
 * (EARS-3), the lifecycle status-swap (EARS-4), and the archived notice (EARS-5)
 * are siblings and are intentionally NOT built here.
 *
 * Rendered per request (`force-dynamic`) — the page reflects a live read model
 * whose lifecycle state can change, so a static prerender would go stale.
 */
export const dynamic = "force-dynamic";

export default async function WebinarEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await fetchPublicEventPage(slug);
  // Draft / unknown / archived-not-yet-handled → not-found (EARS-6); the branded
  // archived notice is EARS-5 (sibling).
  if (!event) notFound();

  const t = await getTranslations("webinar");
  const { date, time } = formatMskParts(event.startsAt);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-header text-header-foreground">
        <Container className="py-10 layout:py-16">
          <p className="text-2xs font-extrabold uppercase tracking-micro opacity-80">
            {t("breadcrumb")}
          </p>
          <p className="mt-6 text-caption font-extrabold uppercase tracking-micro opacity-90">
            {event.school}
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
            {event.title}
          </h1>
          {event.specialties.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-2">
              {event.specialties.map((specialty) => (
                <span
                  key={specialty}
                  className="border-2 border-ring px-3 py-1.5 text-caption font-bold text-header-foreground"
                >
                  {specialty}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <span className="text-base font-bold tabular-nums">
              {t("startsAt", { time, date })}
            </span>
            {event.state === "live" ? (
              <Badge variant="live">{t("state.live")}</Badge>
            ) : (
              <Badge variant="label">{t(`state.${event.state}`)}</Badge>
            )}
          </div>
        </Container>
      </header>

      <Container className="py-12 layout:py-16">
        <WebinarPageContent
          description={event.description}
          speakers={event.speakers}
          partners={event.partners}
          programPdfUrl={event.programPdfUrl}
          aboutLabel={t("page.about")}
          programLabel={t("page.program")}
          programDownloadLabel={t("page.programDownload")}
          speakersLabel={t("page.speakers")}
          sponsorEyebrow={t("page.sponsorEyebrow")}
          sponsorNote={t("page.sponsorNote")}
        />
      </Container>
    </main>
  );
}

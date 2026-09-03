import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@ds/design-system/badge";
import { Link } from "@ds/design-system/link";
import {
  EventAboutSection,
  EventFormatBlock,
  EventPageHero,
  EventPageKicker,
  EventPageShell,
  EventProgrammeSection,
  EventSignupCard,
  EventSpeakerCard,
  eventFormatBlockProps,
  eventLifecycleCountdown,
  eventLifecyclePlate,
  eventPageChips,
  eventPageDateLine,
  eventPageKickerParts,
  eventProgrammeContent,
  eventSignupCardProps,
  eventSpeakerCards,
} from "@ds/design-system/blocks";
import {
  fetchDoctorEventPage,
  fetchDoctorParticipationCta,
} from "@/lib/event-page";

/**
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — `doctor.school/events/:slug`, the
 * doctor storefront's mount of the ONE shared event page.
 *
 * This route is deliberately THIN, for the same reason 019's feed route is: the
 * page is not a doctor.school page that happens to resemble the academy's, it is
 * the SAME page. The read model is `EventPageView`, the composition is the five
 * slice-2 blocks, and the view→props projection is `@ds/design-system`'s shared
 * mapper — so the two storefronts cannot drift on the same event, whichever one
 * a maintainer touches next. What this host owns is the closed list EARS-18
 * allows: 017's shell (inherited from `app/(storefront)/layout.tsx`, nothing new
 * in the header), the route envelope (the «События» breadcrumb back to
 * `/events`, and the participation targets the api resolves against this host's
 * route table), and its copy defaults.
 *
 * It is readable with NO account: the page read is public and forwards only
 * 017's remembered-specialty cookie. Participation is the server's decision
 * (`…/events/:slug/participation`, LD-2) rendered verbatim — this host computes
 * nothing from lifecycle, format, seats or registration. Concretely, a
 * registered doctor on a LIVE event gets `enter-room` with `href: null` here,
 * because doctor.school has no room route yet (#1770 EARS-4): the shared card
 * then renders NO control at all rather than a dead link, which is the whole
 * point of the policy carrying its own target.
 *
 * Not rendered here, deliberately: the social-proof line (EARS-3, #1767), the
 * calendar affordance (#1768), the cancel path (#1769) and the recording player
 * — this host owns none of their data yet, and the shared blocks render nothing
 * where nothing is passed. A placeholder would be the untracked seam F-22
 * forbids.
 *
 * `force-dynamic` — the page reflects a live read model whose lifecycle state
 * can change, and the participation answer is per-viewer (`private, no-store`).
 */
export const dynamic = "force-dynamic";

/** The doctor storefront's copy defaults — the envelope, not the mapping. */
const COPY = {
  breadcrumbEvents: "События",
  about: "О чём событие",
  programme: "Программа",
  programmeDownload: "Скачать программу (PDF)",
  partnersEyebrow: "При поддержке",
  /* The lifecycle words. WHICH plate renders is the mapper's decision
     (`eventLifecyclePlate`); only the word is host copy. */
  state: {
    published: "Скоро",
    live: "В эфире",
    ended: "Эфир завершён",
    hidden: "Скрыто",
  },
} as const;

export default async function DoctorEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const h = await headers();

  // The two reads are independent and issued in parallel: the page body is the
  // same for everyone, the participation answer is this viewer's.
  const [event, cta] = await Promise.all([
    fetchDoctorEventPage(slug, h),
    fetchDoctorParticipationCta(slug, h),
  ]);
  // Draft / unknown → 404. A `hidden` event stays a reachable 200 whose CTA is
  // `unavailable` with the reason in plain words (004 EARS-5 parity).
  if (!event) notFound();

  const formatBlock = eventFormatBlockProps(event);
  const lifecyclePlate = eventLifecyclePlate(event);
  /* Canvas:171 «Скоро · через 5 дней» — the lifecycle word is this host's copy,
     the countdown is the shared mapper's fact about `startsAt` (#1779). */
  const countdown = eventLifecycleCountdown(event);

  return (
    <EventPageShell
      hero={
        <EventPageHero
          breadcrumb={
            <>
              {/* `tone="on-primary"` is the navy-hero link token — the plain
                  link token fails contrast on this surface (axe, ADR-0013). */}
              <Link href="/events" tone="on-primary">
                {COPY.breadcrumbEvents}
              </Link>
              <span aria-hidden="true">/</span>
              <span>{event.title}</span>
            </>
          }
          kicker={<EventPageKicker {...eventPageKickerParts(event)} />}
          title={event.title}
          dateLine={eventPageDateLine(event)}
          chips={eventPageChips(event)}
          statusPlate={
            /* 004 EARS-4 / 020 EARS-18 — the plate decision comes from the
               shared mapper, so an ended or hidden event carries the same
               lifecycle signal on doctor.school as on the academy. */
            lifecyclePlate ? (
              <Badge variant={lifecyclePlate.variant}>
                {countdown
                  ? `${COPY.state[lifecyclePlate.state]} · ${countdown}`
                  : COPY.state[lifecyclePlate.state]}
              </Badge>
            ) : null
          }
        />
      }
      aside={
        cta ? (
          <EventSignupCard {...eventSignupCardProps(event, cta)} pinned />
        ) : null
      }
    >
      <EventAboutSection
        heading={COPY.about}
        description={event.description}
      />

      {/* 020 EARS-2 (#1765) — the programme section always renders: the
          download when the operator attached a PDF, and otherwise the honest
          lifecycle sentence the shared mapper picks. An omitted section and an
          empty labelled box are both banned (EARS-19). */}
      <EventProgrammeSection
        heading={COPY.programme}
        downloadLabel={COPY.programmeDownload}
        {...eventProgrammeContent(event)}
      />

      {eventSpeakerCards(event).map((speaker, index) => (
        <EventSpeakerCard key={index} className="mt-14" {...speaker} />
      ))}

      {formatBlock ? (
        <EventFormatBlock className="mt-14" {...formatBlock} />
      ) : null}

      {event.partners.length > 0 ? (
        <div
          data-testid="event-partners"
          className="mt-14 border-2 border-hairline px-7 py-6"
        >
          <div className="text-eyebrow font-extrabold uppercase tracking-micro text-foreground">
            {COPY.partnersEyebrow}
          </div>
          <div className="mt-2 text-base font-bold text-foreground">
            {event.partners.map((partner) => partner.label).join(" · ")}
          </div>
        </div>
      ) : null}
    </EventPageShell>
  );
}

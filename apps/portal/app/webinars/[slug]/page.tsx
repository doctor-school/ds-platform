import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CircleCheck } from "lucide-react";
import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { Container } from "@ds/design-system/container";
import { WebinarPageContent } from "@ds/design-system/webinar-page-content";
import { WebinarStatusCard } from "@ds/design-system/webinar-status-card";
import { fetchPublicEventPage } from "../../../lib/public-events";
import { resolvePrimaryCta, toCanvasStatus } from "../../../lib/event-lifecycle";
import {
  fetchEventRegistrationState,
  resolveJoinSignpost,
} from "../../../lib/registration-state";
import { formatMskParts } from "../../../lib/msk";
import { RegisterOneTap } from "./register-one-tap";

/**
 * 004 EARS-1 — the public webinar event page, server-rendered. A
 * sponsor-distributed link (`/webinars/:slug`) resolves to complete HTML for an
 * UNAUTHENTICATED recipient: no cookie is read, no client soft-wall, no gated
 * section (the retired legacy "авторизуйтесь для просмотра" overlay is a banned
 * pattern — 004 design §1). The poster header carries the school kicker, the
 * title, the target specialty chips, and the lifecycle-state hero badge; the
 * pulled-up status card + the two-column body below it are the complete decision
 * set from the `PublicEventPage` projection, laid out to `webinar-page.dc.html`.
 *
 * EARS-4: the page reflects the event's current lifecycle from the single
 * `EventLifecycleState`, swapping the hero badge, the status-card time plate, the
 * CTA affordance, and the footer band per the canvas `status` enum
 * (`upcoming | live | ended`) — never a signal that contradicts the machine (the
 * swap lives in `lib/event-lifecycle`; the geometry in the `WebinarStatusCard`
 * DS primitive):
 *   • upcoming (`published`) — «Участвовать» → registration (005) via auth (003),
 *     carrying a same-origin `returnTo` (EARS-3, `lib/registration-handoff`).
 *   • live — a "live now" signal + the single «Участвовать» CTA routing TOWARD
 *     the room (feature 006, `buildRoomHref`); 004 asserts the route, not the room.
 *   • ended — the ended affordance with NO participation CTA (never a dead link,
 *     the exactly-one-CTA invariant).
 *
 * EARS-5: the archived «мероприятие в архиве» notice is the FOURTH render mode on
 * the same page shell (beyond the canvas's upcoming/live/ended) — a text notice
 * replacing the status card's CTA column, no new geometry (design §5.1). A
 * previously-distributed direct link to an archived event degrades gracefully in
 * place (owner variant «а»): it renders this notice with NO participation CTA,
 * never a 404, a redirect, or a dead link.
 *
 * 005 EARS-4: the page also composes the AUTHENTICATED doctor's per-user
 * `EventRegistrationState` onto this 004 render — a SEPARATE authenticated read
 * (`lib/registration-state`) that forwards the request's session cookie, never
 * folded into the public `fetchPublicEventPage` projection or its shared cache
 * (the public read above stays cookie-free + content-identical for guest and
 * principal). A registered doctor is never shown the register CTA as if
 * unregistered; a guest never issues the read and sees 004's register CTA
 * unchanged.
 *
 * 005 EARS-5: for a registered doctor the page signposts HOW/WHEN they join,
 * layered on the lifecycle CTA (`resolveJoinSignpost`): `upcoming` → the «вы
 * записаны» confirmation + the МСК start (the status card time plate), replacing
 * the register CTA; `live` → the confirmation + an obvious ONWARD path to the
 * room (feature 006 route). МСК presentation (EARS-11) reuses the shared
 * `formatMskParts` formatter; all copy resolves through the catalog (EARS-12).
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
  // Draft / unknown → not-found (EARS-6); the branded archived notice is EARS-5.
  if (!event) notFound();

  const t = await getTranslations("webinar");
  const { date, time } = formatMskParts(event.startsAt);

  // EARS-4 — the single lifecycle render mode read from the projection state,
  // and the single primary participation CTA target (register / room / none).
  const status = toCanvasStatus(event.state);
  const cta = resolvePrimaryCta(event.state, event.slug);

  // 005 EARS-4 — the per-user registration state, a SEPARATE authenticated read
  // forwarding the request's session cookie (guest → null → 004's register CTA).
  // `resolveJoinSignpost` (below) turns it into the registered render mode; the
  // register CTA is never shown to a registered doctor.
  const h = await headers();
  const registrationState = await fetchEventRegistrationState(slug, {
    cookie: h.get("cookie") ?? "",
    // The session is fingerprint-bound (ADR-0001 §6) — forward the same surface
    // the browser bound at login so the authed read is not 401'd (see the lib).
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });
  // 005 EARS-5 — the registered doctor's join signposting (how/when they join),
  // layered on the 004 lifecycle CTA: `upcoming` → the confirmation + МСК start
  // signpost (replacing the register CTA); `live` → the confirmation + an obvious
  // ONWARD path toward the room (feature 006 route, carried in `roomHref`); `none`
  // → 004's render stands (unregistered / guest / ended / archived).
  const signpost = resolveJoinSignpost(registrationState, cta);
  const registered = signpost.kind !== "none";
  // 005 EARS-1 — a non-null per-user state means a session rode the request (a
  // logged-in doctor, registered or not); `null` is a guest (no cookie) or an
  // expired/fingerprint-mismatched session that falls back to the public render.
  // A logged-in, NOT-yet-registered doctor on a registrable event gets the
  // one-tap command button; a guest gets the `/register` auth handoff (EARS-2).
  const isAuthenticated = registrationState !== null;
  // EARS-5 — archived is the fourth render mode on the SAME status-card shell: a
  // text notice replaces the CTA column (no button, no dead link), no new
  // geometry. Every state now renders the status card (the archived body swaps
  // its own time-plate/head/sub copy + the CTA-column notice).
  const isArchived = status === "archived";
  // The footer conversion band mirrors the status card's route but only for a
  // participable event (upcoming / live); `ended` and `archived` carry none. A
  // registered doctor's footer «Записаться» band is suppressed too (005 EARS-4)
  // — never re-offer registration to an already-registered doctor. It is ALSO
  // suppressed for a logged-in, not-yet-registered doctor on an `upcoming` event
  // (005 EARS-1): its «Записаться» links to the `/register` guest auth handoff,
  // which would wrongly route a logged-in doctor to the signup form — that doctor
  // already has the status-card one-tap command above. The band stays for guests
  // (drives them to signup) and for `live` (its CTA routes to the room).
  const showFooterBand =
    (status === "upcoming" || status === "live") &&
    !registered &&
    !(status === "upcoming" && isAuthenticated);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="bg-header text-header-foreground">
        <Container className="pt-10 pb-28 layout:pt-16 layout:pb-36">
          <p className="text-2xs font-extrabold uppercase tracking-micro opacity-80">
            {t("breadcrumb")}
          </p>
          <div className="mt-6 flex items-start justify-between gap-8">
            <div className="max-w-3xl">
              <p className="text-caption font-extrabold uppercase tracking-micro opacity-90">
                {event.school}
              </p>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-balance layout:text-5xl">
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
            </div>
            {/* Hero lifecycle badge (EARS-4 swap): live → the pulsing «В эфире»
                danger tag; every other state → the pale label with its state copy
                («Скоро» / «Эфир завершён» / «В архиве»). */}
            {event.state === "live" ? (
              <Badge variant="live" className="mt-1 shrink-0">
                {t("state.live")}
              </Badge>
            ) : (
              <Badge variant="label" className="mt-1 shrink-0">
                {t(`state.${event.state}`)}
              </Badge>
            )}
          </div>
        </Container>
      </header>

      <Container className="pb-12 layout:pb-16">
        {/* EARS-4/EARS-5 — the pulled-up status card overlaps the poster (canvas
            -80px). It swaps the time plate + head/sub + the single CTA per
            lifecycle state; the `ended` render passes no CTA (no dead link), and
            the `archived` render (EARS-5) replaces the CTA column with a plain
            text notice — no participation affordance, no new geometry. */}
        <div className="relative z-10 -mt-20">
          <WebinarStatusCard
            live={status === "live"}
            liveLabel={t("state.live")}
            timeLabel={t(`statusCard.${status}.timeLabel`)}
            time={time}
            timeSub={t(`statusCard.${status}.timeSub`, {
              date,
              duration: event.durationMin,
            })}
            head={
              signpost.kind === "upcoming"
                ? t("registered.upcoming.head")
                : signpost.kind === "live"
                  ? t("registered.live.head")
                  : t(`statusCard.${status}.head`)
            }
            sub={
              signpost.kind === "upcoming"
                ? t("registered.upcoming.sub")
                : signpost.kind === "live"
                  ? t("registered.live.sub")
                  : t(`statusCard.${status}.sub`)
            }
          >
            {isArchived ? (
              // The CTA column becomes a non-interactive «в архиве» notice — no
              // button, no link (EARS-5, owner variant «а»). `text-primary-action`
              // (blue.700) is the card-safe AA token on `bg-card` (never
              // `text-primary`, the #270 precedent).
              <p className="text-sm font-bold text-primary-action">
                {t("statusCard.archived.notice")}
              </p>
            ) : signpost.kind === "upcoming" ? (
              // 005 EARS-5 — registered + upcoming: the register CTA is replaced by
              // a static «вы записаны» confirmation. The МСК start date/time is the
              // status card's own time plate (`time` + `timeSub`), and the how/when
              // signposting is the head/sub above — no second action.
              // `text-primary-action` (blue.700) is the card-safe AA token on
              // `bg-card` (never `text-primary`, the #270 precedent).
              <p className="inline-flex items-center gap-2 text-sm font-bold text-primary-action">
                <CircleCheck aria-hidden className="size-5" />
                {t("registered.confirmation")}
              </p>
            ) : signpost.kind === "live" ? (
              // 005 EARS-5 — registered + live: the «вы записаны» confirmation PLUS
              // an obvious onward path to the room. The room route (feature 006) is
              // carried in `signpost.roomHref` — 005 asserts the ROUTE, 006 owns the
              // room + its server-side join gating.
              <>
                <p className="inline-flex items-center gap-2 text-sm font-bold text-primary-action">
                  <CircleCheck aria-hidden className="size-5" />
                  {t("registered.confirmation")}
                </p>
                <Button asChild size="lg">
                  <Link href={signpost.roomHref}>{t("registered.live.cta")}</Link>
                </Button>
              </>
            ) : cta.kind === "register" && isAuthenticated ? (
              // 005 EARS-1 — logged-in doctor, not yet registered on a registrable
              // (upcoming/`published`) event: the CTA is a ONE-ACTION command that
              // POSTs `RegisterForEvent` and re-reads the state, not a trip through
              // auth. The guest path keeps the `/register` handoff link below.
              <RegisterOneTap
                slug={event.slug}
                label={t("cta.participate")}
                errorLabel={t("cta.registerError")}
              />
            ) : cta.kind !== "none" ? (
              <Button asChild size="lg">
                <Link href={cta.href}>{t("cta.participate")}</Link>
              </Button>
            ) : null}
          </WebinarStatusCard>
        </div>

        <div className="mt-16">
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
        </div>
      </Container>

      {/* EARS-4 — the bottom conversion band swaps per state and drops entirely
          for `ended` (no dead CTA). Its action reuses the single CTA route with a
          distinct footer verb, so the page keeps exactly one «Участвовать» primary
          CTA (EARS-3 invariant): upcoming → «Записаться» (registration), live →
          «Смотреть эфир» (room seam 006). */}
      {showFooterBand && cta.kind !== "none" ? (
        <div className="bg-header text-header-foreground">
          <Container className="flex flex-wrap items-center justify-between gap-8 py-12 layout:py-14">
            <p className="text-2xl font-extrabold tracking-tight text-balance layout:text-3xl">
              {t(`footer.${status}.title`)}{" "}
              <span className="opacity-80">{t(`footer.${status}.sub`)}</span>
            </p>
            <Button asChild size="lg">
              <Link href={cta.href}>{t(`footer.${status}.cta`)}</Link>
            </Button>
          </Container>
        </div>
      ) : null}
    </main>
  );
}

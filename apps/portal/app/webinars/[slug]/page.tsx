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
 *   • live — a "live now" signal + the single «Участвовать» CTA that REGISTERS
 *     (005 EARS-1/EARS-9: register-during-live is a normal path — one-tap for an
 *     authenticated doctor, the auth handoff for a guest). The room and its
 *     onward navigation are the 006 surface (#584) — no render links to `/room`
 *     until it ships (a dead link / 404 is a banned pattern).
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
 * layered on the lifecycle render (`resolveJoinSignpost`): `upcoming` → the «вы
 * записаны» confirmation + the МСК start (the status card time plate), replacing
 * the register CTA; `live` → the confirmation + the "broadcast is on" signpost.
 * The interactive onward-to-room affordance is the 006 room surface (#584) and
 * lands with it — never a dead `/room` link here. МСК presentation (EARS-11)
 * reuses the shared `formatMskParts` formatter; all copy resolves through the
 * catalog (EARS-12).
 *
 * Rendered per request (`force-dynamic`) — the page reflects a live read model
 * whose lifecycle state can change, so a static prerender would go stale.
 */
export const dynamic = "force-dynamic";

export default async function WebinarEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { slug } = await params;
  const event = await fetchPublicEventPage(slug);
  // Draft / unknown → not-found (EARS-6); the branded archived notice is EARS-5.
  if (!event) notFound();

  const t = await getTranslations("webinar");
  // 006 EARS-6 / EARS-10 — access-branch guidance: a doctor bounced from the room
  // for being unregistered arrives with `?from=room`. The catalog-sourced guidance
  // (`room` namespace) is surfaced above the 005 register front door below, so the
  // routing is a truthful, guided front door — not a silent redirect.
  const tRoom = await getTranslations("room");
  const fromRoom = (await searchParams).from === "room";
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
  // layered on the 004 lifecycle render: `upcoming` → the confirmation + МСК
  // start signpost (replacing the register CTA); `live` → the confirmation + the
  // "broadcast is on" signpost (the onward room affordance is the 006 room
  // surface, #584); `none` → 004's render stands (unregistered / guest / ended /
  // archived).
  const signpost = resolveJoinSignpost(registrationState, status);
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
  // participable event (upcoming / live); `ended` and `archived` carry none. It
  // is a GUEST conversion band: its CTA links to the `/register` auth handoff,
  // which would wrongly route a logged-in doctor to the signup form — an
  // authenticated doctor already has the status-card affordance above (the
  // one-tap command when unregistered, 005 EARS-1; the registered confirmation
  // otherwise, 005 EARS-4 — never re-offer registration to a registered doctor).
  const showFooterBand =
    (status === "upcoming" || status === "live") && !isAuthenticated;
  // 006 EARS-6 — show the room access-branch guidance ONLY when the doctor arrived
  // from the room (`?from=room`) AND the 005 register front door is actually the
  // rendered affordance (authenticated, unregistered, registrable — the exact
  // `RegisterOneTap` condition below). A registered doctor, a guest, or an
  // ended/archived event never sees a stale «register to join» banner.
  const showRoomAccessGuidance =
    fromRoom &&
    isAuthenticated &&
    !isArchived &&
    signpost.kind === "none" &&
    cta.kind === "register";

  return (
    <main className="min-h-screen bg-background text-foreground">
      {showRoomAccessGuidance ? (
        // A light strip above the poster (card-safe AA tokens on `bg-card` — the
        // #270 precedent, `text-primary-action` = blue.700, never `text-primary`).
        // No new geometry, no CTA of its own — the 005 register front door below is
        // the single action.
        <div
          data-testid="room-access-guidance"
          className="border-b-2 border-border bg-card"
        >
          <Container className="py-4">
            <p className="text-sm font-extrabold text-primary-action">
              {tRoom("accessGuidance.title")}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {tRoom("accessGuidance.body")}
            </p>
          </Container>
        </div>
      ) : null}
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
              // 005 EARS-5 — registered + live: the «вы записаны» confirmation +
              // the "broadcast is on" signpost (the card head/sub). The interactive
              // onward-to-room affordance is the 006 room surface (#584) — until it
              // ships, no link renders here (a `/room` link would 404, a banned
              // dead-end; the deferral is tracked on #584).
              <p className="inline-flex items-center gap-2 text-sm font-bold text-primary-action">
                <CircleCheck aria-hidden className="size-5" />
                {t("registered.confirmation")}
              </p>
            ) : cta.kind === "register" && isAuthenticated ? (
              // 005 EARS-1 — logged-in doctor, not yet registered on a registrable
              // (upcoming/`published` OR `live`, EARS-9) event: the CTA is a
              // ONE-ACTION command that POSTs `RegisterForEvent` and re-reads the
              // state — never a trip through auth, never a navigation to the
              // not-yet-built 006 room. The guest path keeps the `/register`
              // handoff link below.
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
          CTA (EARS-3 invariant): upcoming AND live → «Записаться» (registration —
          register-during-live is a normal path, 005 EARS-9; the room is 006/#584). */}
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

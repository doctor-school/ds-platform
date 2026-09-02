import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CircleCheck } from "lucide-react";
import { Badge } from "@ds/design-system/badge";
import { Button } from "@ds/design-system/button";
import { Container } from "@ds/design-system/container";
import { WebinarPageContent } from "@ds/design-system/webinar-page-content";
import { WebinarRecordingPlaque } from "@ds/design-system/webinar-recording-plaque";
import { WebinarStatusCard } from "@ds/design-system/webinar-status-card";
import { fetchPublicEventPage } from "../../../lib/public-events";
import { resolvePrimaryCta, toCanvasStatus } from "../../../lib/event-lifecycle";
import {
  resolvePlayerCard,
  resolveRecordingSignal,
} from "../../../lib/recording-signal";
import { fetchEventPlayback } from "../../../lib/event-playback";
import { withReturnTarget } from "../../../lib/registration-handoff";
import {
  fetchEventRegistrationState,
  resolveJoinSignpost,
  resolveRoomEntryHref,
} from "../../../lib/registration-state";
import { formatMskParts } from "../../../lib/msk";
import { RegisterOneTap } from "./register-one-tap";
import { RecordingGate } from "./recording-gate";
import { RecordingPlayer } from "./recording-player";

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
 *     authenticated doctor, the auth handoff for a guest). For a doctor already
 *     registered on the live event the CTA becomes the 006 EARS-6 ENTER-ROOM link
 *     into the shipped room surface (`/webinars/:slug/room`) — a real front door,
 *     never a dead link.
 *   • ended — the ended affordance with NO participation CTA (never a dead link,
 *     the exactly-one-CTA invariant).
 *
 * EARS-5: the hidden «мероприятие скрыто» notice is the FOURTH render mode on
 * the same page shell (beyond the canvas's upcoming/live/ended) — a text notice
 * replacing the status card's CTA column, no new geometry (design §5.1). A
 * previously-distributed direct link to a hidden event degrades gracefully in
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
 * the register CTA; `live` → the confirmation + the "broadcast is on" signpost +
 * the 006 EARS-6 enter-room CTA (`resolveRoomEntryHref`) into the now-shipped room
 * surface (`/webinars/:slug/room`) — the onward affordance that landed with the
 * room, never a dead link. МСК presentation (EARS-11) reuses the shared
 * `formatMskParts` formatter; all copy resolves through the catalog (EARS-12).
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
  // Draft / unknown → not-found (EARS-6); the branded hidden notice is EARS-5.
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
  // hidden).
  const signpost = resolveJoinSignpost(registrationState, status);
  // 006 EARS-6 — the registered-live room front door: the room surface shipped
  // (`/webinars/:slug/room`, EARS-1..7), so the entry CTA deferred to #584 is
  // restored. Non-null EXACTLY when a registered doctor is on a `live` event (the
  // same condition the room gate admits them under) → the canonical, hardened room
  // path; `null` in every other branch, so no room link renders.
  const roomEntryHref = resolveRoomEntryHref(registrationState, status, event.slug);
  // 005 EARS-1 — a non-null per-user state means a session rode the request (a
  // logged-in doctor, registered or not); `null` is a guest (no cookie) or an
  // expired/fingerprint-mismatched session that falls back to the public render.
  // A logged-in, NOT-yet-registered doctor on a registrable event gets the
  // one-tap command button; a guest gets the `/register` auth handoff (EARS-2).
  const isAuthenticated = registrationState !== null;
  // EARS-5 — hidden is the fourth render mode on the SAME status-card shell: a
  // text notice replaces the CTA column (no button, no dead link), no new
  // geometry. Every state now renders the status card (the hidden body swaps
  // its own time-plate/head/sub copy + the CTA-column notice).
  const isHidden = status === "hidden";
  // 014 EARS-4 — the source-free recording signal, read from the SAME public
  // projection the rest of this render uses (`event.recording`, resolved api-side
  // by the one canonical resolver, so the page and the listing card can never
  // disagree). Non-null only on `ended`; the player itself is #1343, the
  // readiness-date plaque #1344 and the raw spoiler #1345 — this slice renders
  // the availability signal and nothing that pretends to be those.
  const recordingSignal = resolveRecordingSignal(event.recording, status);
  // 014 EARS-5 — the AUTHENTICATED source read, the ONLY source-bearing response
  // in the feature (design §5). Issued exactly when it can produce something: a
  // session rode the request AND the public projection already says something is
  // published. A guest render never calls it, so no playable source can reach a
  // guest's HTML; a `preparing` render never calls it either, because the plaque
  // owns that card regardless of who is looking.
  const playback =
    isAuthenticated && recordingSignal?.available
      ? await fetchEventPlayback(slug, {
          cookie: h.get("cookie") ?? "",
          userAgent: h.get("user-agent") ?? "",
          acceptLanguage: h.get("accept-language") ?? "",
        })
      : null;
  // 014 EARS-5 / EARS-7 — WHAT the player card holds this render: exactly one of
  // the player, the guest gate, the «запись готовится» plaque, or the honest
  // unavailability message (design §8.1 — never two stacked, never empty). The
  // plaque branch self-clears on the next render after the operator publishes:
  // the page is `force-dynamic` and the mode derives purely from the projection,
  // with no timer or cached "we already promised" flag to go stale.
  const playerCard = resolvePlayerCard(
    event.recording,
    status,
    isAuthenticated,
    playback,
  );
  // 014 EARS-6 — both gate actions carry THIS page as a same-origin returnTo, so
  // a guest who signs in lands back here with the player mounted. The target is
  // built by the shared guard (`withReturnTarget`), never a hand-rolled query
  // param — a hostile slug can therefore never surface an open redirect.
  const gateReturnTo = `/webinars/${encodeURIComponent(slug)}`;
  // The footer conversion band mirrors the status card's route but only for a
  // participable event (upcoming / live); `ended` and `hidden` carry none. It
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
  // ended/hidden event never sees a stale «register to join» banner.
  const showRoomAccessGuidance =
    fromRoom &&
    isAuthenticated &&
    !isHidden &&
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
          <p
            className="text-2xs font-extrabold uppercase tracking-micro opacity-80"
            data-testid="poster-decor"
          >
            {t("breadcrumb")}
          </p>
          <div className="mt-6 flex items-start justify-between gap-8">
            <div className="max-w-3xl">
              <p
                className="text-caption font-extrabold uppercase tracking-micro opacity-90"
                data-testid="poster-decor"
              >
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
            {/* Hero lifecycle badge (004 EARS-4 swap): live → the pulsing «В
                эфире» danger tag; every other state → the pale label with its
                state copy («Скоро» / «Эфир завершён» / «Скрыт»).

                014 EARS-4: on an ENDED event the badge speaks about the
                RECORDING instead — «Запись доступна» (green) or «Запись
                готовится» (the neutral label) — because that is the one thing a
                post-live visitor came to find out, and «Эфир завершён» merely
                restates the date they can already read. `hidden` is
                deliberately untouched: 004 EARS-5's «Скрыт» owns that render. */}
            {event.state === "live" ? (
              <Badge variant="live" className="mt-1 shrink-0">
                {t("state.live")}
              </Badge>
            ) : recordingSignal ? (
              <Badge
                data-testid="recording-badge"
                variant={recordingSignal.available ? "success" : "label"}
                className="mt-1 shrink-0"
              >
                {t(`recordingBadge.${recordingSignal.badgeKey}`)}
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
            the `hidden` render (EARS-5) replaces the CTA column with a plain
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
            {isHidden ? (
              // The CTA column becomes a non-interactive «скрыт» notice — no
              // button, no link (EARS-5, owner variant «а»). `text-primary-action`
              // (blue.700) is the card-safe AA token on `bg-card` (never
              // `text-primary`, the #270 precedent).
              <p className="text-sm font-bold text-primary-action">
                {t("statusCard.hidden.notice")}
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
            ) : roomEntryHref ? (
              // 005 EARS-5 + 006 EARS-6 — registered + live: the «вы записаны»
              // confirmation + the "broadcast is on" signpost (the card head/sub),
              // and now the restored ENTER-ROOM CTA. The 006 room surface shipped
              // (`/webinars/:slug/room`, EARS-1..7), so the onward-to-room affordance
              // deferred to #584 lands here — a real link into the room the doctor is
              // gated into, its label catalog-sourced (EARS-10), never a dead link.
              <div className="flex flex-col items-start gap-3">
                <p className="inline-flex items-center gap-2 text-sm font-bold text-primary-action">
                  <CircleCheck aria-hidden className="size-5" />
                  {t("registered.confirmation")}
                </p>
                <Button asChild size="lg">
                  <Link href={roomEntryHref}>{t("registered.live.cta")}</Link>
                </Button>
              </div>
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
            {/* 014 EARS-5 — the recording meta («Монтаж · 90 мин») deliberately
                does NOT appear here any more. #1341 put it in this column while
                the player position was empty; now that the player card below
                renders the same kind + duration in every one of its four modes,
                repeating it in the status card would be the same fact stated
                twice on one screen (the dedup obligation recorded at #1697). */}
          </WebinarStatusCard>
        </div>

        {/* 014 EARS-7 — the plaque sits in the player position: below the status
            card, above the page body, exactly where the player will mount
            (#1343). It carries the operator's readiness DAY when there is one
            («до 18 июля») and an honest date-free line when there is not —
            never an invented estimate (the canvas's «≈2 дня» is placeholder
            art), and never a «Напомнить на почту» button: readiness
            notifications are a declared 014 non-goal, so that control would be
            a dead affordance. */}
        {playerCard ? (
          <div className="mt-10" data-testid="player-card">
            {playerCard.mode === "plaque" ? (
              <div data-testid="recording-plaque">
                <WebinarRecordingPlaque
                  timeLabel={t("plaque.timeLabel")}
                  time={
                    playerCard.expectedByLabel
                      ? t("plaque.timeValue", {
                          date: playerCard.expectedByLabel,
                        })
                      : null
                  }
                  title={t("plaque.title")}
                  body={
                    playerCard.expectedByLabel
                      ? t("plaque.bodyDated", {
                          date: playerCard.expectedByLabel,
                        })
                      : t("plaque.bodyUndated")
                  }
                />
              </div>
            ) : playerCard.mode === "gate" ? (
              // A guest on a published recording: the canvas login gate. The
              // source is not in this HTML at all — the authenticated read was
              // never issued above — so this is a real gate, not a soft wall.
              <RecordingGate
                posterUrl={event.recording.posterUrl}
                kindLabel={t(`recordingKind.${playerCard.kindKey}`)}
                metaLabel={t("playerGate.eyebrow", {
                  duration: event.durationMin,
                })}
                title={t("playerGate.title")}
                body={t("playerGate.body")}
                ctaLabel={t("playerGate.cta")}
                signInHref={withReturnTarget("/login", gateReturnTo)}
                noAccountLabel={t("playerGate.noAccount")}
                signUpLabel={t("playerGate.signUp")}
                signUpHref={withReturnTarget("/register", gateReturnTo)}
              />
            ) : (
              // The signed-in doctor's card. `RecordingPlayer` owns BOTH the
              // mounted frame and the unavailability message with its retry (its
              // failure boundary is a client branch — the api ships no "the embed
              // is broken" status, design §5), so the `unavailable` mode here is
              // the same component reached with no source: one component, one
              // honest failed state, never a second copy of the copy.
              <>
                <p
                  data-testid="recording-meta"
                  className="mb-3 text-2xs font-extrabold uppercase tracking-micro text-muted-foreground"
                >
                  {t(`recordingKind.${playerCard.kindKey}`)} ·{" "}
                  {t("recordingKind.duration", { duration: event.durationMin })}
                </p>
                <RecordingPlayer
                  provider={
                    playerCard.mode === "player" ? playerCard.provider : null
                  }
                  embedRef={
                    playerCard.mode === "player" ? playerCard.embedRef : null
                  }
                  title={event.title}
                  kindLabel={t(`recordingKind.${playerCard.kindKey}`)}
                  unavailableTitle={t("playerUnavailable.title")}
                  unavailableBody={t("playerUnavailable.body")}
                  retryLabel={t("playerUnavailable.retry")}
                />
              </>
            )}
          </div>
        ) : null}

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
              <span className="opacity-80" data-testid="poster-decor">
                {t(`footer.${status}.sub`)}
              </span>
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

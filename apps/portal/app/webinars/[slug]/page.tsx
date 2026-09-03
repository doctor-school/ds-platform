import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Badge } from "@ds/design-system/badge";
import { Link } from "@ds/design-system/link";
import { WebinarRecordingPlaque } from "@ds/design-system/webinar-recording-plaque";
import {
  EventFormatBlock,
  EventPageHero,
  EventPageShell,
  EventSectionHeading,
  EventSignupCard,
  EventSpeakerCard,
  eventFormatBlockProps,
  eventPageChips,
  eventPageDateLine,
  eventPageKicker,
  eventSignupCardProps,
  eventSpeakerCards,
} from "@ds/design-system/blocks";
import { fetchPublicEventPage } from "../../../lib/public-events";
import { fetchParticipationCta } from "../../../lib/participation-cta";
import { toCanvasStatus } from "../../../lib/event-lifecycle";
import {
  resolvePlayerCard,
  resolveRecordingSignal,
} from "../../../lib/recording-signal";
import { fetchEventPlayback } from "../../../lib/event-playback";
import { withReturnTarget } from "../../../lib/registration-handoff";
import { fetchEventRegistrationState } from "../../../lib/registration-state";
import { RegisterOneTap } from "./register-one-tap";
import { RecordingGate } from "./recording-gate";
import { RecordingPlayer } from "./recording-player";

/**
 * The academy storefront's mount of the ONE shared event page
 * (`/webinars/:slug`).
 *
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — this route no longer owns a
 * composition. It is fetch → shared projection → the slice-2 blocks
 * (`EventPageShell` · `EventPageHero` · `EventSignupCard` · `EventSpeakerCard` ·
 * `EventFormatBlock`), the same five the doctor storefront mounts at
 * `/events/:slug` from the same `EventPageView`. What this host still owns is
 * exactly what EARS-18 permits it to own: its header shell, its route envelope
 * (the `/webinars` breadcrumb, the `/webinars/:slug/room` targets the api
 * resolves for it) and its copy defaults. There is no academy-local read model,
 * no academy-local CTA resolver and no import from `apps/doctor`.
 *
 * The participation control is the SERVER-resolved {@link ParticipationCta}
 * (`GET /v1/public/events/:slug/participation`), rendered as given. The 004
 * `resolvePrimaryCta` / `buildRegistrationHref` pair that used to compute it
 * here is gone: eligibility is one decision and it is made once, api-side, for
 * both storefronts (020-design §1.1). The only thing this host adds is the
 * ELEMENT for the `register` action when a session rode the request — the 005
 * EARS-1 one-tap command, which POSTs and re-reads in place instead of routing
 * a signed-in doctor back through auth. It is a rendering slot on the shared
 * card, never a second policy: the card renders it only inside the branch the
 * server's action already opened.
 *
 * 004 EARS-1: a sponsor-distributed link resolves to complete server-rendered
 * HTML for an UNAUTHENTICATED recipient — no cookie read, no client soft-wall,
 * no gated section.
 *
 * 004 EARS-4/EARS-5: the lifecycle render swap is the hero's status plate and
 * the server CTA, both derived from the single `EventLifecycleState` — `ended`
 * and `hidden` resolve to `unavailable`, so the page carries NO participation
 * control and no dead link, and the hidden event's «мероприятие скрыто» answer
 * is the CTA's own `reason` rather than a fourth host-local render mode.
 *
 * 005 EARS-4/EARS-5: the registered doctor's state is the server CTA too
 * (`registered` → the «Вы записаны» statement; `enter-room` → the 006 room link
 * the api resolves from this host's route table). The separate authenticated
 * registration read survives only for what the CTA cannot answer: whether a
 * session rode the request at all, which is what gates the 014 playback read.
 *
 * 014 EARS-4..EARS-7: the recording signal, the login gate, the readiness plaque
 * and the player keep their own place in the left reading flow, source-free for
 * a guest by construction (the authenticated playback read is never issued).
 *
 * Rendered per request (`force-dynamic`) — the page reflects a live read model
 * whose lifecycle state can change, so a static prerender would go stale, and
 * the participation answer is per-viewer (`private, no-store`).
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
  // Draft / unknown → not-found (EARS-6); the hidden event stays a reachable 200.
  if (!event) notFound();

  const t = await getTranslations("webinar");
  // 006 EARS-6 / EARS-10 — access-branch guidance: a doctor bounced from the room
  // for being unregistered arrives with `?from=room`. The catalog-sourced guidance
  // is surfaced above the page so the routing is a truthful, guided front door.
  const tRoom = await getTranslations("room");
  const fromRoom = (await searchParams).from === "room";

  const h = await headers();
  const session = {
    cookie: h.get("cookie") ?? "",
    // The session is fingerprint-bound (ADR-0001 §6) — forward the same surface
    // the browser bound at login so an authed read is not 401'd.
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  };

  // 020 EARS-1 — the ONE participation decision, resolved server-side for this
  // viewer on this event. A `null` here would mean the event vanished between
  // the two reads; the page keeps rendering and simply carries no control.
  const cta = await fetchParticipationCta(slug, session);
  // 005 EARS-4 — a non-null per-user state means a session rode the request. The
  // CTA already says WHAT to render; this read survives only to gate the 014
  // authenticated playback call and to choose the one-tap ELEMENT below.
  const registrationState = await fetchEventRegistrationState(slug, session);
  const isAuthenticated = registrationState !== null;

  // 004 EARS-4 / 014 EARS-4 — the canvas lifecycle enum drives the hero status
  // plate and the recording signal; it drives NO participation branch any more.
  const status = toCanvasStatus(event.state);
  const recordingSignal = resolveRecordingSignal(event.recording, status);
  // 014 EARS-5 — the AUTHENTICATED source read, the ONLY source-bearing response
  // in the feature. Issued exactly when it can produce something, so no playable
  // source can ever reach a guest's HTML.
  const playback =
    isAuthenticated && recordingSignal?.available
      ? await fetchEventPlayback(slug, session)
      : null;
  const playerCard = resolvePlayerCard(
    event.recording,
    status,
    isAuthenticated,
    playback,
  );
  // 014 EARS-6 — both gate actions carry THIS page as a same-origin returnTo,
  // built by the shared guard so a hostile slug can never surface an open redirect.
  const gateReturnTo = `/webinars/${encodeURIComponent(slug)}`;
  // 006 EARS-6 — the room access-branch guidance shows ONLY when the doctor
  // arrived from the room AND the register front door is actually what renders.
  const showRoomAccessGuidance =
    fromRoom && isAuthenticated && cta?.action === "register";
  // 005 EARS-1 — the logged-in doctor's one-tap command replaces the generated
  // link for the SAME server-resolved `register` action. A guest keeps the
  // `/register` auth handoff the api resolved (EARS-2).
  const oneTap =
    cta?.action === "register" && isAuthenticated ? (
      <RegisterOneTap
        slug={event.slug}
        label={cta.label}
        errorLabel={t("cta.registerError")}
      />
    ) : undefined;

  const formatBlock = eventFormatBlockProps(event);

  return (
    <>
      {showRoomAccessGuidance ? (
        // A light strip above the hero (card-safe AA tokens on `bg-card` — the
        // #270 precedent, `text-primary-action` = blue.700, never `text-primary`).
        // No CTA of its own — the sign-up card is the single action.
        <div
          data-testid="room-access-guidance"
          className="border-b-2 border-border bg-card px-4 py-4 layout:px-gutter"
        >
          <div className="mx-auto max-w-content">
            <p className="text-sm font-extrabold text-primary-action">
              {tRoom("accessGuidance.title")}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {tRoom("accessGuidance.body")}
            </p>
          </div>
        </div>
      ) : null}
      <EventPageShell
        hero={
          <EventPageHero
            breadcrumb={
              <>
                <Link href="/webinars" tone="on-primary">
                  {t("breadcrumb")}
                </Link>
                <span aria-hidden="true">/</span>
                <span>{event.title}</span>
              </>
            }
            kicker={eventPageKicker(event)}
            title={event.title}
            dateLine={eventPageDateLine(event)}
            chips={eventPageChips(event)}
            statusPlate={
              /* 004 EARS-4 swap: live → the «В эфире» tag; every other state
                 carries its own lifecycle word («Скоро» / «Эфир завершён» /
                 «Скрыто»), so the hero can never contradict the machine. 014
                 EARS-4 then adds the RECORDING badge BESIDE it on an ended
                 event — what a post-live visitor came to find out — rather than
                 replacing the lifecycle signal with it. `in_archive` is a
                 legacy эфир whose only public signal IS its recording, and it
                 has no lifecycle word of its own (014-design §3.1). */
              event.state === "live" ? (
                <Badge variant="live">{t("state.live")}</Badge>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  {event.state === "in_archive" ? null : (
                    <Badge variant="label">{t(`state.${event.state}`)}</Badge>
                  )}
                  {recordingSignal ? (
                    <Badge
                      data-testid="recording-badge"
                      variant={recordingSignal.available ? "success" : "label"}
                    >
                      {t(`recordingBadge.${recordingSignal.badgeKey}`)}
                    </Badge>
                  ) : null}
                </div>
              )
            }
          />
        }
        aside={
          cta ? (
            <EventSignupCard
              {...eventSignupCardProps(event, cta)}
              control={oneTap}
              pinned
            />
          ) : null
        }
      >
        {playerCard ? (
          <div className="mb-14" data-testid="player-card">
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
              // A guest on a published recording: the login gate. The source is
              // not in this HTML at all — the authenticated read was never
              // issued above — so this is a real gate, not a soft wall.
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
              // mounted frame and the unavailability message with its retry, so
              // there is one component and one honest failed state.
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

        <section data-testid="event-about">
          <EventSectionHeading>{t("page.about")}</EventSectionHeading>
          <p className="mt-7 text-base leading-relaxed text-pretty text-foreground">
            {event.description}
          </p>
        </section>

        {/* 004 EARS-2 — the programme download, rendered only when the operator
            attached one (never a broken link). `text-primary-action` is the
            card-safe AA link token (#270), never `text-primary`. */}
        {event.programPdfUrl ? (
          <section className="mt-14" data-testid="event-programme">
            <EventSectionHeading>{t("page.program")}</EventSectionHeading>
            <Link
              href={event.programPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-7 inline-flex items-center gap-3 border-2 border-border bg-card px-6 py-4 text-sm shadow-ghost"
            >
              <span aria-hidden="true">↓</span>
              {t("page.programDownload")}
            </Link>
          </section>
        ) : null}

        {eventSpeakerCards(event).map((speaker, index) => (
          <EventSpeakerCard key={index} className="mt-14" {...speaker} />
        ))}

        {formatBlock ? (
          <EventFormatBlock className="mt-14" {...formatBlock} />
        ) : null}

        {/* The sponsor plate — the event's declared partners, stated plainly. */}
        {event.partners.length > 0 ? (
          <div
            data-testid="event-partners"
            className="mt-14 border-2 border-hairline px-7 py-6"
          >
            <div className="text-eyebrow font-extrabold uppercase tracking-micro text-foreground">
              {t("page.sponsorEyebrow")}
            </div>
            <div className="mt-2 text-base font-bold text-foreground">
              {event.partners.map((partner) => partner.label).join(" · ")}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
              {t("page.sponsorNote")}
            </p>
          </div>
        ) : null}
      </EventPageShell>
    </>
  );
}

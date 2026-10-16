import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge } from "@ds/design-system/badge";
import { Link } from "@ds/design-system/link";
import { RecordingSpoiler } from "@ds/design-system/recording-spoiler";
import { WebinarRecordingPlaque } from "@ds/design-system/webinar-recording-plaque";
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
  resolvePlayerCard,
  resolveRecordingSignal,
  toCanvasStatus,
} from "@ds/events-storefront";
import {
  fetchEventRegistrationState,
  fetchParticipationCta,
  fetchPublicEventPage,
  forwardedSessionFrom,
} from "@ds/events-storefront/server";
import { RegisterOneTap } from "@ds/events-storefront/ui";
import { withReturnTarget } from "@ds/schemas";
import { EVENT_PAGE_COPY as COPY } from "../copy/event-page-copy";
import type { EventPageHostConfig } from "../host-config";
import { fetchEventPlayback } from "../server/event-playback";
import { RecordingGate } from "./recording-gate";
import { RecordingPlayer } from "./recording-player";

export interface EventPageProps {
  /** The mounting storefront's data-only event-page config (gate §4.4). */
  config: EventPageHostConfig;
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}

/**
 * The ONE shared event page (`@ds/event-page`, epic #2020 wave 3, #2072). A
 * storefront mounts it from its event-page route with its host config; the
 * Academy mounts it at `/webinars/:slug` (wave-3 PR 3.1).
 *
 * 020 EARS-1 / EARS-18 (#1764, slice 3) — the page is fetch → shared
 * projection → the slice-2 blocks (`EventPageShell` · `EventPageHero` ·
 * `EventSignupCard` · `EventSpeakerCard` · `EventFormatBlock`). What a host
 * still states is exactly what EARS-18 permits it to own, and only as config
 * values: its read path, its route envelope (the breadcrumb target, the
 * gate's door routes, the event-page path the gate returns to) and its
 * breadcrumb word. The room targets are resolved by the api from the calling
 * host's route table. There is no host-local read model and no host-local CTA
 * resolver.
 *
 * The participation control is the SERVER-resolved {@link ParticipationCta}
 * (`GET ${pagePath}/:slug/participation`), rendered as given: eligibility is
 * one decision and it is made once, api-side, for both storefronts (020-design
 * §1.1). The only thing the page adds is the ELEMENT for the `register` action
 * when a session rode the request — the 005 EARS-1 one-tap command, which
 * POSTs and re-reads in place instead of routing a signed-in doctor back
 * through auth. It is a rendering slot on the shared card, never a second
 * policy: the card renders it only inside the branch the server's action
 * already opened.
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
 * the api resolves from the host's route table). The separate authenticated
 * registration read survives only for what the CTA cannot answer: whether a
 * session rode the request at all, which is what gates the 014 playback read.
 *
 * 014 EARS-4..EARS-7: the recording signal, the login gate, the readiness plaque
 * and the player keep their own place in the left reading flow, source-free for
 * a guest by construction (the authenticated playback read is never issued).
 *
 * The mounting route declares `dynamic = "force-dynamic"` (a segment config
 * cannot live in a package): the page reflects a live read model whose
 * lifecycle state can change, and the participation answer is per-viewer
 * (`private, no-store`).
 */
export async function EventPage({
  config,
  params,
  searchParams,
}: EventPageProps) {
  const { slug } = await params;
  const event = await fetchPublicEventPage(slug, config.contentSet.pagePath);
  // Draft or unknown slug renders not-found; a hidden event stays a reachable 200.
  if (!event) notFound();

  // Access-branch guidance: a doctor bounced from the room for being unregistered
  // arrives with `?from=room`. The guidance is surfaced above the page so the
  // routing is a truthful, guided front door.
  const fromRoom = (await searchParams).from === "room";

  const h = await headers();
  // The session is fingerprint-bound (ADR-0001 §6) — the shared builder carries
  // the same surface the browser bound at login, forwarded client address
  // included, so an authed read is not 401'd (#2054).
  const session = forwardedSessionFrom(h);

  // The ONE participation decision, resolved server-side for this
  // viewer on this event. A `null` here would mean the event vanished between
  // the two reads; the page keeps rendering and simply carries no control.
  const cta = await fetchParticipationCta(
    slug,
    session,
    config.contentSet.pagePath,
  );
  // A non-null per-user state means a session rode the request. The CTA already
  // says WHAT to render; this read survives only to gate the authenticated
  // playback call and to choose the one-tap ELEMENT below.
  const registrationState = await fetchEventRegistrationState(slug, session);
  const isAuthenticated = registrationState !== null;

  // The canvas lifecycle enum drives the hero status plate and the recording
  // signal; it drives NO participation branch any more.
  const status = toCanvasStatus(event.state);
  const recordingSignal = resolveRecordingSignal(event.recording, status);
  // The AUTHENTICATED source read, the ONLY source-bearing response on this page. Issued exactly when it can produce something, so no playable
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
  // Both gate actions carry THIS page as a same-origin returnTo,
  // built by the shared guard so a hostile slug can never surface an open redirect.
  const gateReturnTo = `${config.routes.eventPage}/${encodeURIComponent(slug)}`;
  // The room access-branch guidance shows ONLY when the doctor
  // arrived from the room AND the register front door is actually what renders.
  const showRoomAccessGuidance =
    fromRoom && isAuthenticated && cta?.action === "register";
  // The logged-in doctor's one-tap command replaces the generated link for the
  // SAME server-resolved `register` action. A guest keeps the `/register` auth
  // handoff the api resolved.
  const oneTap =
    cta?.action === "register" && isAuthenticated ? (
      <RegisterOneTap
        slug={event.slug}
        returnTo={gateReturnTo}
        label={cta.label}
        errorLabel={COPY.cta.registerError}
      />
    ) : undefined;

  const formatBlock = eventFormatBlockProps(event);
  const lifecyclePlate = eventLifecyclePlate(event);
  /* Canvas:171 «Скоро · через 5 дней» — the lifecycle word is the page's copy,
     the countdown is the shared mapper's fact about `startsAt` (#1779). */
  const countdown = eventLifecycleCountdown(event);

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
              {COPY.accessGuidance.title}
            </p>
            <p className="mt-1 text-sm text-foreground">
              {COPY.accessGuidance.body}
            </p>
          </div>
        </div>
      ) : null}
      <EventPageShell
        hero={
          <EventPageHero
            breadcrumb={
              <>
                <Link href={config.routes.listing} tone="on-primary">
                  {config.copy.breadcrumb}
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
              /* 004 EARS-4 swap: live → the «В эфире» tag; every other state
                 carries its own lifecycle word («Скоро» / «Эфир завершён» /
                 «Скрыто»), so the hero can never contradict the machine. 014
                 EARS-4 then adds the RECORDING badge BESIDE it on an ended
                 event — what a post-live visitor came to find out — rather than
                 replacing the lifecycle signal with it. `in_archive` is a
                 legacy эфир whose only public signal IS its recording, and it
                 has no lifecycle word of its own (014-design §3.1). */
              lifecyclePlate?.variant === "live" ? (
                <Badge variant="live">{COPY.state[lifecyclePlate.state]}</Badge>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  {lifecyclePlate ? (
                    <Badge variant={lifecyclePlate.variant}>
                      {countdown
                        ? `${COPY.state[lifecyclePlate.state]} · ${countdown}`
                        : COPY.state[lifecyclePlate.state]}
                    </Badge>
                  ) : null}
                  {recordingSignal ? (
                    <Badge
                      data-testid="recording-badge"
                      variant={recordingSignal.available ? "success" : "label"}
                    >
                      {COPY.recordingBadge[recordingSignal.badgeKey]}
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
                  timeLabel={COPY.plaque.timeLabel}
                  time={
                    playerCard.expectedByLabel
                      ? COPY.plaque.timeValue(playerCard.expectedByLabel)
                      : null
                  }
                  title={COPY.plaque.title}
                  body={
                    playerCard.expectedByLabel
                      ? COPY.plaque.bodyDated(playerCard.expectedByLabel)
                      : COPY.plaque.bodyUndated
                  }
                />
              </div>
            ) : playerCard.mode === "gate" ? (
              // A guest on a published recording: the login gate. The source is
              // not in this HTML at all — the authenticated read was never
              // issued above — so this is a real gate, not a soft wall.
              <RecordingGate
                posterUrl={event.recording.posterUrl}
                kindLabel={COPY.recordingKind[playerCard.kindKey]}
                metaLabel={COPY.playerGate.eyebrow(event.durationMin)}
                title={COPY.playerGate.title}
                body={COPY.playerGate.body}
                ctaLabel={COPY.playerGate.cta}
                signInHref={withReturnTarget(config.routes.login, gateReturnTo)}
                noAccountLabel={COPY.playerGate.noAccount}
                signUpLabel={COPY.playerGate.signUp}
                signUpHref={withReturnTarget(
                  config.routes.register,
                  gateReturnTo,
                )}
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
                  {COPY.recordingKind[playerCard.kindKey]} ·{" "}
                  {COPY.recordingKind.duration(event.durationMin)}
                </p>
                <RecordingPlayer
                  provider={
                    playerCard.mode === "player" ? playerCard.provider : null
                  }
                  embedRef={
                    playerCard.mode === "player" ? playerCard.embedRef : null
                  }
                  title={event.title}
                  kindLabel={COPY.recordingKind[playerCard.kindKey]}
                  unavailableTitle={COPY.playerUnavailable.title}
                  unavailableBody={COPY.playerUnavailable.body}
                  retryLabel={COPY.playerUnavailable.retry}
                />
                {/* 014 EARS-8 (#1345) — the raw-original SPOILER. It exists
                    only when the authenticated playback read carried a SECOND
                    published cut: `secondary` is non-null exactly when both an
                    edited and a raw recording are published, so a single-kind
                    эфир renders no secondary affordance at all rather than an
                    empty or disabled one. It lives on the signed-in branch by
                    construction — `playback` is the authenticated source read,
                    and a guest never reaches this fragment (EARS-5's
                    no-source-bytes invariant). The block mounts its child only
                    while open, so the second provider frame is not requested
                    until the doctor asks for it. */}
                {playback?.secondary ? (
                  <RecordingSpoiler
                    data-testid="recording-spoiler"
                    className="mt-4"
                    summaryLabel={COPY.recordingSpoiler.summary}
                    hint={COPY.recordingSpoiler.hint}
                  >
                    <RecordingPlayer
                      provider={playback.secondary.provider}
                      embedRef={playback.secondary.embedRef}
                      title={event.title}
                      kindLabel={COPY.recordingKind[playback.secondary.kind]}
                      unavailableTitle={COPY.playerUnavailable.title}
                      unavailableBody={COPY.playerUnavailable.body}
                      retryLabel={COPY.playerUnavailable.retry}
                    />
                  </RecordingSpoiler>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <EventAboutSection
          heading={COPY.page.about}
          description={event.description}
        />

        {/* 020 EARS-2 (#1765) — the shared programme section. With a PDF it is
            the download; without one it states the honest lifecycle sentence
            the mapper picks, so the academy and doctor.school tell a doctor the
            same thing about the same missing programme (EARS-18/EARS-19). */}
        <EventProgrammeSection
          heading={COPY.page.program}
          downloadLabel={COPY.page.programDownload}
          {...eventProgrammeContent(event)}
        />

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
              {COPY.page.sponsorEyebrow}
            </div>
            <div className="mt-2 text-base font-bold text-foreground">
              {event.partners.map((partner) => partner.label).join(" · ")}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-muted-foreground">
              {COPY.page.sponsorNote}
            </p>
          </div>
        ) : null}
      </EventPageShell>
    </>
  );
}

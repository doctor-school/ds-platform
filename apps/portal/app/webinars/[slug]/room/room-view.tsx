"use client";

import { Badge } from "@ds/design-system/badge";
import { Link } from "@ds/design-system/link";
import { WebinarRoomLayout } from "@ds/design-system/webinar-room";
import { resolveEmbed } from "../../../../lib/room-player";
import type { RoomConfig } from "@ds/schemas";
import { RoomChat } from "./room-chat";

/**
 * 006 EARS-2 / EARS-3 / EARS-9 / EARS-11 — the room composition for a gated
 * caller. The server component ({@link RoomPage}) has already consumed the EARS-1
 * `RoomAccess` grant; this client view renders the neo-brutalist composition to
 * the vendored `webinar-room.dc.html` geometry via the {@link WebinarRoomLayout}
 * DS primitive: the embed player (instantiated from the explicit provider enum,
 * EARS-2), the event context, and the LIVE chat aside — {@link RoomChat} reads +
 * posts over Centrifugo (EARS-3) when the grant carried a chat credential, else a
 * truthful "chat unavailable" state (Centrifugo unconfigured). The full
 * both-breakpoints × both-themes fidelity + Stage-B live confirmation is the
 * integration slice #584.
 *
 * All copy is injected from the message catalog (EARS-10) — no hardcoded
 * user-facing string lives here; {@link RoomChat} reads its own copy from the same
 * catalog via `useTranslations`.
 */
export interface RoomCopy {
  liveBadge: string;
  onAir: string;
  chatTab: string;
  infoTab: string;
  chatUnavailable: string;
  unavailableTitle: string;
  unavailableBody: string;
  playerTitle: string;
  programNow: string;
  directLinkPrompt: string;
  directLinkCta: string;
}

export interface RoomContext {
  school: string;
  title: string;
  speakers: string;
}

function PlayerFrame({ config, copy }: { config: RoomConfig; copy: RoomCopy }) {
  const embed = resolveEmbed(config.stream);
  return (
    <div>
      <div className="relative aspect-video border-2 border-border bg-neutral-950 shadow-lg">
        <Badge variant="live" className="absolute left-5 top-5 z-10">
          {copy.liveBadge}
        </Badge>
        {embed.kind === "unavailable" ? (
          // EARS-2 — truthful "stream unavailable" state: no guessed embed. The gate
          // still admitted the caller; there is simply no player to instantiate.
          <div
            data-testid="room-player-unavailable"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center"
          >
            <p className="text-lg font-extrabold text-primary-foreground">
              {copy.unavailableTitle}
            </p>
            <p className="text-sm text-neutral-300">{copy.unavailableBody}</p>
          </div>
        ) : (
          // EARS-9 — an embed FRAME only: a plain provider iframe, no transcode /
          // re-host / proxy / DRM / record and no player-level telemetry. `src` is
          // built by switching on the provider ENUM, never by sniffing the URL.
          <iframe
            data-testid={`room-player-${embed.kind}`}
            src={embed.src}
            title={copy.playerTitle}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        )}
      </div>
      {embed.kind !== "unavailable" && (
        // #1125 — an ALWAYS-PRESENT truthful direct-watch link beneath the player.
        // A well-formed embed can still render a silent black iframe the app cannot
        // detect cross-origin (YouTube geo-blocked in RU, or «Allow embedding» left
        // off on the broadcast). The direct provider watch page is the honest escape
        // hatch — shown whenever there IS a stream, not gated on an undetectable
        // iframe failure. Opens the provider's own page in a new tab.
        <p
          data-testid="room-player-direct-link"
          className="mt-3 text-sm leading-relaxed text-muted-foreground"
        >
          {copy.directLinkPrompt}{" "}
          <Link
            variant="inline"
            href={embed.directUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.directLinkCta}
          </Link>
        </p>
      )}
    </div>
  );
}

function EventContext({
  context,
  copy,
}: {
  context: RoomContext;
  copy: RoomCopy;
}) {
  return (
    <div data-testid="room-context">
      <p className="text-caption font-extrabold uppercase tracking-micro text-primary-action">
        {context.school}
      </p>
      <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground layout:text-3xl">
        {context.title}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {context.speakers}
      </p>
      <div className="mt-7 flex items-center gap-5 border-2 border-hairline px-6 py-4">
        <span className="text-sm leading-snug text-muted-foreground">
          {copy.programNow}
        </span>
      </div>
    </div>
  );
}

/**
 * The truthful "chat unavailable" state — shown ONLY when the grant carried no
 * chat credential (`config.chat` is null, i.e. Centrifugo is not configured on
 * this runtime). It is a truthful state, NOT a disabled composer placeholder: the
 * room never presents a dead affordance a doctor could type into with no effect.
 */
function ChatUnavailable({ copy }: { copy: RoomCopy }) {
  return (
    <div data-testid="room-chat" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
        {copy.chatUnavailable}
      </div>
    </div>
  );
}

export function RoomView({
  slug,
  config,
  context,
  copy,
}: {
  slug: string;
  config: RoomConfig;
  context: RoomContext;
  copy: RoomCopy;
}) {
  return (
    <WebinarRoomLayout
      chatTabLabel={copy.chatTab}
      infoTabLabel={copy.infoTab}
      player={<PlayerFrame config={config} copy={copy} />}
      context={<EventContext context={context} copy={copy} />}
      chat={
        config.chat ? (
          <RoomChat slug={slug} chat={config.chat} />
        ) : (
          <ChatUnavailable copy={copy} />
        )
      }
      slimBar={
        <div className="border-b-2 border-border bg-card px-4 py-3">
          <p className="text-2xs font-extrabold uppercase tracking-micro text-primary-action">
            {copy.onAir}
          </p>
          <p className="mt-1 text-sm font-bold leading-snug text-foreground">
            {context.title}
          </p>
        </div>
      }
    />
  );
}

"use client";

import { Badge } from "@ds/design-system/badge";
import { WebinarRoomLayout } from "@ds/design-system/webinar-room";
import { resolveEmbed } from "../../../../lib/room-player";
import type { RoomConfig } from "@ds/schemas";

/**
 * 006 EARS-2 / EARS-9 / EARS-11 — the room composition for a gated caller. The
 * server component ({@link RoomPage}) has already consumed the EARS-1 `RoomAccess`
 * grant; this client view renders the neo-brutalist composition to the vendored
 * `webinar-room.dc.html` geometry via the {@link WebinarRoomLayout} DS primitive:
 * the embed player (instantiated from the explicit provider enum, EARS-2), the
 * event context, and the chat aside COMPOSITION SHELL (chat behaviour — live
 * read/post over Centrifugo — is EARS-3 / #579; the full both-breakpoints × both-
 * themes fidelity + Stage-B live confirmation is the integration slice #584).
 *
 * All copy is injected from the message catalog by the server component (EARS-10)
 * — no hardcoded user-facing string lives here.
 */
export interface RoomCopy {
  liveBadge: string;
  onAir: string;
  chatTab: string;
  infoTab: string;
  chatHeading: string;
  moderatorPin: string;
  chatEmpty: string;
  composerPlaceholder: string;
  composerSend: string;
  unavailableTitle: string;
  unavailableBody: string;
  playerTitle: string;
  programNow: string;
}

export interface RoomContext {
  school: string;
  title: string;
  speakers: string;
}

function PlayerFrame({ config, copy }: { config: RoomConfig; copy: RoomCopy }) {
  const embed = resolveEmbed(config.stream);
  return (
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

function ChatPanel({ copy }: { copy: RoomCopy }) {
  return (
    <div data-testid="room-chat" className="flex min-h-0 flex-1 flex-col">
      <div className="border-b-2 border-border bg-primary-action px-4 py-3 text-center text-sm font-extrabold text-primary-foreground">
        {copy.chatHeading}
      </div>
      <div className="border-b-2 border-border bg-tint px-4 py-3 text-caption leading-relaxed text-tint-foreground">
        {copy.moderatorPin}
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-sm text-muted-foreground">
        {copy.chatEmpty}
      </div>
      {/* Composer — composition shell only; posting rides Centrifugo in EARS-3
          (#579). Presented, not yet wired: the room's live chat lands with #579. */}
      <div className="flex gap-3 border-t-2 border-border p-4">
        <input
          placeholder={copy.composerPlaceholder}
          aria-label={copy.composerPlaceholder}
          disabled
          className="min-w-0 flex-1 border-2 border-hairline bg-card px-4 py-3 text-sm text-foreground"
        />
        <button
          type="button"
          disabled
          aria-label={copy.composerSend}
          className="border-2 border-border bg-primary-action px-4 py-3 text-sm font-extrabold text-primary-foreground shadow-sm"
        >
          {copy.composerSend}
        </button>
      </div>
    </div>
  );
}

export function RoomView({
  config,
  context,
  copy,
}: {
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
      chat={<ChatPanel copy={copy} />}
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

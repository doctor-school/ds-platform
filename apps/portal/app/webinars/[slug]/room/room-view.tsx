"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@ds/design-system/badge";
import { WebinarRoomLayout } from "@ds/design-system/webinar-room";
import { useTranslations } from "next-intl";
import { resolveEmbed } from "../../../../lib/room-player";
import { usePlayerFailureState } from "../../../../lib/use-player-failure-state";
import type { RoomConfig } from "@ds/schemas";
import { RoomChat } from "./room-chat";
import { usePresenceCount } from "./room-presence";

/**
 * 006 EARS-2 / EARS-3 / EARS-9 / EARS-11 — the room composition for a gated
 * caller, reworked to the Twitch-model canvases (#1123). The server component
 * ({@link RoomPage}) has already consumed the EARS-1 grant; this client view
 * renders the viewport-bounded shell via {@link WebinarRoomLayout}: a maximized
 * player region (the embed iframe pinned `inset-0`, EARS-2 / EARS-9 — no custom
 * player chrome), a one-line context strip, and the collapsible chat column —
 * {@link RoomChat} reads + posts over Centrifugo (EARS-3) when the grant carried a
 * chat credential, else a truthful "chat unavailable" state.
 *
 * The desktop chat column collapses to a rail; collapse state + the unread counter
 * (messages missed while folded) live HERE (the composition parent) so the DS
 * layout stays a pure presentation shell and {@link RoomChat} — which owns the live
 * connection — is never unmounted by the fold. The live presence count feeds the
 * chat-column header from {@link usePresenceCount} (the same aggregate the room
 * header reads) via a plain prop — the DS package imports no portal context.
 *
 * All copy is injected from the message catalog (EARS-10) — no hardcoded
 * user-facing string.
 */
export interface RoomCopy {
  liveBadge: string;
  onAir: string;
  chatTab: string;
  infoTab: string;
  chatHeading: string;
  chatCollapse: string;
  chatExpand: string;
  chatUnavailable: string;
  unavailableTitle: string;
  unavailableBody: string;
  playerTitle: string;
  playerRefresh: string;
  // 006 EARS-18 — the in-room player-FAILURE overlay copy (a mounted embed that
  // never starts playing), distinct from the config-absent `unavailable*` state.
  playerFailedTitle: string;
  playerFailedBody: string;
  playerEmbeddingDisabled: string;
  playerUnavailable: string;
  playerRetrying: string;
  // 006 EARS-18 — the SUSPECTED-grade non-covering advisory copy (watchdog stall with
  // no observable signal — a possibly-healthy but unobservable stream).
  playerSuspectedBody: string;
  playerRestart: string;
  programNow: string;
}

export interface RoomContext {
  school: string;
  title: string;
  speakers: string;
}

/** The fixed-white outline restart control — the same «Перезапустить плеер» affordance
 *  in both the CONFIRMED overlay and the SUSPECTED banner (EARS-18.3). primitives-first-ok:
 *  every themed DS Button variant flips with the theme and renders wrong on the
 *  PERMANENTLY-dark player region (matches the EARS-2 refresh button). */
function RestartButton({
  label,
  onRestart,
  className = "",
}: {
  label: string;
  onRestart: () => void;
  className?: string;
}) {
  return (
    // primitives-first-ok: fixed-white outline control on the PERMANENTLY-dark player
    // letterbox — every themed DS Button variant flips with the theme and renders wrong
    // on the always-dark region (matches the EARS-2 refresh button).
    <button
      type="button"
      data-testid="room-player-restart"
      onClick={onRestart}
      className={`border-2 border-white/50 font-extrabold text-white cursor-pointer hover:border-white focus-visible:outline-none focus-visible:shadow-focus ${className}`}
    >
      {label}
    </button>
  );
}

/**
 * 006 EARS-18 CONFIRMED grade — the truthful, COVERING in-frame failure overlay for a
 * proven failure (an observed provider error, or a watchdog stall AFTER the provider
 * handshake was established — real signal loss). It covers the embed with specific
 * truthful copy; a bounded auto-retry runs, then the manual «Перезапустить плеер»
 * re-creates the embed. NEVER a silent black frame, a full page reload, or an
 * off-platform link. Rides over the still-live iframe so a provider self-heal's
 * playing event still clears it (EARS-18.4).
 */
function PlayerFailureOverlay({
  status,
  failure,
  copy,
  onRestart,
}: {
  status: "failed" | "retrying";
  failure: "embedding-disabled" | "unavailable" | "generic" | null;
  copy: RoomCopy;
  onRestart: () => void;
}) {
  const title =
    failure === "embedding-disabled"
      ? copy.playerEmbeddingDisabled
      : failure === "unavailable"
        ? copy.playerUnavailable
        : copy.playerFailedTitle;
  return (
    <div
      data-testid="room-player-failure"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 bg-black/80 px-6 text-center"
    >
      <p className="text-lg font-extrabold text-white">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-white/60">
        {status === "retrying" ? copy.playerRetrying : copy.playerFailedBody}
      </p>
      {status === "failed" && (
        <RestartButton label={copy.playerRestart} onRestart={onRestart} className="mt-2.5 px-5 py-3 text-sm" />
      )}
    </div>
  );
}

/**
 * 006 EARS-18 SUSPECTED grade — the NON-COVERING advisory banner for an UNPROVABLE
 * failure: the watchdog elapsed with no positive signal ever observed (vk + cdnvideo
 * always — no parent API; youtube/rutube when no handshake arrived). The room can NOT
 * prove the stream failed — a healthy video may simply be unobservable — so the embed
 * stays FULLY VISIBLE and interactive (the banner container is `pointer-events-none`;
 * only the restart button captures clicks) and there is NO auto-retry (an auto
 * re-create would interrupt a possibly-healthy stream). Soft truthful copy + the same
 * manual «Перезапустить плеер». A later playing signal clears it (EARS-18.4).
 */
function PlayerSuspectedBanner({ copy, onRestart }: { copy: RoomCopy; onRestart: () => void }) {
  return (
    <div
      data-testid="room-player-suspected"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-black/70 px-5 py-3 text-center"
    >
      <p className="text-sm leading-snug text-white/80">{copy.playerSuspectedBody}</p>
      <RestartButton
        label={copy.playerRestart}
        onRestart={onRestart}
        className="pointer-events-auto px-4 py-2 text-2xs uppercase tracking-micro"
      />
    </div>
  );
}

/** Post the YouTube IFrame Player API `listening` handshake so the embed streams
 *  its state/error events to the parent (EARS-18.2). Best-effort — a script-less,
 *  RU-safe path; failure degrades to the watchdog floor, never breaks the room. */
function postYouTubeListening(iframe: HTMLIFrameElement) {
  iframe.contentWindow?.postMessage(
    JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
    "https://www.youtube.com",
  );
}

export function PlayerFrame({ config, copy }: { config: RoomConfig; copy: RoomCopy }) {
  const embed = resolveEmbed(config.stream);
  // 006 EARS-18 — the runtime player-failure state machine. Hooks run unconditionally
  // (a config-absent `unavailable` embed still calls it with a harmless provider);
  // it only drives the iframe branch below.
  const provider = embed.kind === "unavailable" ? "cdnvideo" : embed.kind;
  const { status, grade, failure, embedKey, restart } = usePlayerFailureState(provider);
  // The `origin` param YouTube's IFrame API wants is resolved AFTER mount so the
  // first client render matches SSR (both `?enablejsapi=1`), avoiding a hydration
  // mismatch; the extra param arrives on the post-mount re-render.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  if (embed.kind === "unavailable") {
    // EARS-2 — truthful "stream unavailable" state, canvas-styled (dark region,
    // «Обновить страницу» outline button): no guessed embed. The gate still
    // admitted the caller; there is simply no player to instantiate.
    return (
      <div
        data-testid="room-player-unavailable"
        className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center"
      >
        <p className="text-lg font-extrabold text-white">
          {copy.unavailableTitle}
        </p>
        <p className="max-w-sm text-sm leading-relaxed text-white/60">
          {copy.unavailableBody}
        </p>
        {/* primitives-first-ok: fixed-white outline control on the PERMANENTLY-dark
            player letterbox — every themed DS Button variant flips with the theme
            and renders wrong on the always-dark region (webinar-room-frame.dc.html). */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2.5 border-2 border-white/50 px-5 py-3 text-sm font-extrabold text-white cursor-pointer hover:border-white focus-visible:outline-none focus-visible:shadow-focus"
        >
          {copy.playerRefresh}
        </button>
      </div>
    );
  }
  // EARS-9 — an embed FRAME only: a plain provider iframe filling the region, no
  // transcode / re-host / proxy / DRM / record and no custom player chrome (the
  // provider owns its own controls inside the iframe). `src` is built by switching
  // on the provider ENUM, never by sniffing the URL. The live overlay badge rides
  // on top. There is deliberately NO off-platform/direct link in the room — the
  // platform must not invite viewers off-platform (presence control is the sponsor
  // value; owner decision 2026-07-24).
  //
  // EARS-18.2 — for YouTube, request the IFrame Player API events (`enablejsapi=1`
  // + `origin`); the watchdog is the universal floor for every provider regardless.
  const src =
    embed.kind === "youtube"
      ? `${embed.src}?enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`
      : embed.src;
  return (
    <>
      <Badge variant="live" className="absolute left-4 top-4 z-10">
        {copy.liveBadge}
      </Badge>
      <iframe
        // EARS-18.3 — the mount key: each auto-retry / «Перезапустить плеер» bumps it,
        // re-creating the embed in place (never a full page reload).
        key={embedKey}
        data-testid={`room-player-${embed.kind}`}
        src={src}
        title={copy.playerTitle}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        onLoad={
          embed.kind === "youtube"
            ? (e) => postYouTubeListening(e.currentTarget)
            : undefined
        }
        className="absolute inset-0 h-full w-full"
      />
      {/* CONFIRMED grade — covering overlay + (auto-retry) manual restart. */}
      {(status === "retrying" || (status === "failed" && grade === "confirmed")) && (
        <PlayerFailureOverlay
          status={status}
          failure={failure}
          copy={copy}
          onRestart={restart}
        />
      )}
      {/* SUSPECTED grade — non-covering advisory banner, embed stays visible. */}
      {status === "failed" && grade === "suspected" && (
        <PlayerSuspectedBanner copy={copy} onRestart={restart} />
      )}
    </>
  );
}

/** Desktop: the one-line context strip under the player (eyebrow · title · speakers). */
function ContextStrip({ context }: { context: RoomContext }) {
  return (
    <div
      data-testid="room-context-strip"
      className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1"
    >
      <span className="text-2xs font-extrabold uppercase tracking-micro text-primary-action whitespace-nowrap">
        {context.school}
      </span>
      <span className="text-sm font-extrabold tracking-tight text-foreground">
        {context.title}
      </span>
      <span className="text-caption text-muted-foreground">
        {context.speakers}
      </span>
    </div>
  );
}

/** Mobile О эфире tab: the full event-context block (title, speakers, "now on air"). */
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
      <h1 className="mt-2.5 text-2xl font-extrabold tracking-tight text-foreground">
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
 * this runtime). It is a truthful state, NOT a disabled composer placeholder.
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
  const t = useTranslations("room");
  const presenceCount = usePresenceCount();
  // Desktop chat collapse + the unread counter (messages missed while folded).
  // Owned here so the DS shell stays presentation-only and RoomChat — which holds
  // the live Centrifugo connection — is never unmounted by the fold.
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);
  const onIncomingWhileCollapsed = useCallback(
    (delta: number) => setUnread((n) => n + delta),
    [],
  );

  return (
    <WebinarRoomLayout
      chatTabLabel={copy.chatTab}
      infoTabLabel={copy.infoTab}
      chatHeading={copy.chatHeading}
      chatCount={presenceCount}
      chatUnread={unread}
      chatUnreadLabel={t("chatUnread", { count: unread })}
      collapseLabel={copy.chatCollapse}
      expandLabel={copy.chatExpand}
      onChatCollapsedChange={(next) => {
        setCollapsed(next);
        setUnread(0);
      }}
      player={<PlayerFrame config={config} copy={copy} />}
      contextStrip={<ContextStrip context={context} />}
      context={<EventContext context={context} copy={copy} />}
      chat={
        config.chat ? (
          <RoomChat
            slug={slug}
            chat={config.chat}
            collapsed={collapsed}
            onIncomingWhileCollapsed={onIncomingWhileCollapsed}
          />
        ) : (
          <ChatUnavailable copy={copy} />
        )
      }
      slimBar={
        <div className="flex items-center gap-2.5 border-b-2 border-border bg-card px-4 py-2.5">
          <span className="text-2xs font-extrabold uppercase tracking-micro text-primary-action whitespace-nowrap">
            {copy.onAir}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
            {context.title}
          </span>
        </div>
      }
    />
  );
}

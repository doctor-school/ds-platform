import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchMyDisplayName } from "../../../../lib/my-display-name";
import { fetchPublicEventPage } from "../../../../lib/public-events";
import { fetchRoomConfig } from "../../../../lib/room-config";
import { buildRoomReturnHref } from "../../../../lib/room-return";
import { DisplayNamePrompt } from "./display-name-prompt";
import { PresenceHeartbeat } from "./presence-heartbeat";
import { RoomHeader } from "./room-header";
import { RoomPresenceProvider } from "./room-presence";
import { RoomView } from "./room-view";

/**
 * 006 EARS-2 — the webinar room surface, `/webinars/:slug/room`. Server-rendered:
 * it consumes the EARS-1 server-side `RoomAccess` grant (it does NOT re-implement
 * the gate) and renders the room composition ONLY where the grant exists.
 *
 * The grant's three refusals route TRUTHFULLY (never a soft wall over a rendered
 * player — this is the EARS-6 denied-access routing, «the front door»):
 *   • auth      → the 003 login flow, carrying a same-origin `returnTo` back to
 *                 THIS room url so the gate RE-RUNS on return (re-evaluated); on
 *                 success the doctor lands on the room again, admitted iff now
 *                 registered ∧ live, else re-routed by the same three branches. No
 *                 registration is fired on the visitor's behalf (`room-return`).
 *   • register  → the 004/005 event page carrying `?from=room`, which surfaces the
 *                 catalog-sourced access-branch guidance (EARS-10) above the 005
 *                 one-tap register front door; on register the doctor re-enters the
 *                 room (admitted on success).
 *   • not-live  → the 004 event page (the truthful lifecycle state — upcoming /
 *                 ended / archived — with no watchable room; no register banner,
 *                 the lifecycle render is itself the truthful signal).
 *   • not-found → Next.js not-found (unknown / draft — no "exists" oracle).
 *
 * The embed player is instantiated from the grant's explicit provider enum
 * (EARS-2) inside {@link RoomView}; an unknown/absent provider renders the
 * truthful "stream unavailable" state. Rendered per request (the grant is
 * per-caller + the lifecycle can change) — never statically prerendered.
 */
export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const h = await headers();
  // The session is fingerprint-bound (ADR-0001 §6) — forward the same surface the
  // browser bound at login so every authed server read is not 401'd.
  const session = {
    cookie: h.get("cookie") ?? "",
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  };
  const access = await fetchRoomConfig(slug, session);

  const roomReturn = buildRoomReturnHref(slug);
  const eventPage = `/webinars/${encodeURIComponent(slug)}`;
  switch (access.kind) {
    case "auth":
      // Carry a `returnTo` back to THIS room url so the gate re-evaluates on
      // return — after login (or signup) the doctor lands on the room again, not on
      // `/account` (the room return is guard-parsed by `completeReturnTarget`, which
      // routes to the room and fires no registration).
      redirect(`/login?returnTo=${encodeURIComponent(roomReturn)}`);
    // eslint-disable-next-line no-fallthrough -- redirect() throws; unreachable
    case "register":
      // Guide an authenticated-but-unregistered doctor to the 005 register front
      // door on the event page; `?from=room` surfaces the access-branch guidance
      // (EARS-10) so the doctor understands why they were routed here.
      redirect(`${eventPage}?from=room`);
    // eslint-disable-next-line no-fallthrough -- redirect() throws; unreachable
    case "not-live":
      // The truthful 004 lifecycle state (upcoming / ended / archived) — no room,
      // no register banner (the lifecycle render is the truthful signal on its own).
      redirect(eventPage);
    // eslint-disable-next-line no-fallthrough -- redirect() throws; unreachable
    case "not-found":
      notFound();
  }

  // Granted — compose the room. The event context (school / title / speakers) is
  // the public 004 projection; a live event always has one.
  const event = await fetchPublicEventPage(slug);
  if (!event) notFound();

  // 006 EARS-14 — the JIT display-name step, a PRE-RENDER gate BEFORE the room is
  // composed (not a fourth admission condition — the server gate above is
  // unchanged). A gated doctor with no saved name is prompted ONCE; the prompt PUTs
  // the name and refreshes, so on the next read this is non-null and the room
  // renders. Self-only read (EARS-16) — served to the owner's session alone.
  const displayName = await fetchMyDisplayName(session);
  if (displayName === null) return <DisplayNamePrompt />;

  const t = await getTranslations("room");
  const speakers = event.speakers.map((s) => s.name).join(" · ");

  return (
    // 006 EARS-11 (#1123) — the Twitch-model room is VIEWPORT-BOUNDED: the shell
    // fills the viewport height (`h-dvh`) and clips its overflow, so the page never
    // scrolls; the header is `flex-none` and the room body ({@link RoomView}) flexes
    // to the remaining height, where only the chat ledger scrolls.
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* 006 EARS-5 — the live room-presence count («N врачей в комнате») is a
          client aggregate shared between the invisible heartbeat loop (which owns
          the beat→ack) and the header (which renders it). The provider seeds it
          from the EARS-1 grant and the loop refreshes it each beat. */}
      <RoomPresenceProvider initialCount={access.config.presenceCount}>
        {/* 006 EARS-2 / EARS-5 / EARS-11 — the room's top app-header bar (canvas
            header, ADR-0013 canvas-wins): brand-home wordmark + reused live pill
            with the «· N мин» duration on the left, the live presence count +
            truthful exit on the right. `flex-none` so the room body flexes to full
            height below it (mobile full-height). */}
        <RoomHeader
          eventHref={eventPage}
          liveAt={access.config.liveAt}
          displayName={displayName}
          copy={{
            brandHome: t("brandHome"),
            liveBadge: t("liveBadge"),
            exit: t("exit"),
            themeToggle: t("themeToggle"),
            avatarLabel: t("avatarLabel", { name: displayName }),
          }}
        />
        {/* EARS-4 — the visibility-gated server-authoritative heartbeat loop. No
            rendered affordance; it POSTs a beat every N seconds while the tab is
            visible (N from the grant), capturing presence from mount and pushing
            the live presence count from each ack into the provider (EARS-5). */}
        <PresenceHeartbeat
          slug={slug}
          intervalSeconds={access.config.heartbeatIntervalSeconds}
        />
        <RoomView
          slug={slug}
          config={access.config}
          context={{ school: event.school, title: event.title, speakers }}
          copy={{
            liveBadge: t("liveBadge"),
            onAir: t("onAir"),
            chatTab: t("chatTab"),
            infoTab: t("infoTab"),
            chatHeading: t("chatHeading"),
            chatCollapse: t("chatCollapse"),
            chatExpand: t("chatExpand"),
            chatUnavailable: t("chatUnavailable"),
            unavailableTitle: t("unavailableTitle"),
            unavailableBody: t("unavailableBody"),
            playerTitle: t("playerTitle"),
            playerRefresh: t("playerRefresh"),
            playerFailedTitle: t("playerFailedTitle"),
            playerFailedBody: t("playerFailedBody"),
            playerEmbeddingDisabled: t("playerEmbeddingDisabled"),
            playerUnavailable: t("playerUnavailable"),
            playerRetrying: t("playerRetrying"),
            playerRestart: t("playerRestart"),
            programNow: t("programNow"),
          }}
        />
      </RoomPresenceProvider>
    </main>
  );
}

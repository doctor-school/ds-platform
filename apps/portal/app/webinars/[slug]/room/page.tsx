import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchPublicEventPage } from "../../../../lib/public-events";
import { fetchRoomConfig } from "../../../../lib/room-config";
import { PresenceHeartbeat } from "./presence-heartbeat";
import { RoomView } from "./room-view";

/**
 * 006 EARS-2 — the webinar room surface, `/webinars/:slug/room`. Server-rendered:
 * it consumes the EARS-1 server-side `RoomAccess` grant (it does NOT re-implement
 * the gate) and renders the room composition ONLY where the grant exists.
 *
 * The grant's three refusals route TRUTHFULLY (never a soft wall over a rendered
 * player — the full EARS-6 denied-access routing is its own handler; this surface
 * consumes the grant and routes minimally so no branch dead-ends):
 *   • auth      → the 003 login flow, carrying a same-origin returnTo back here;
 *   • register  → the 004/005 event page (its register CTA is the front door);
 *   • not-live  → the 004 event page (the truthful lifecycle state, no room);
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
  const access = await fetchRoomConfig(slug, {
    cookie: h.get("cookie") ?? "",
    // The session is fingerprint-bound (ADR-0001 §6) — forward the same surface
    // the browser bound at login so the authed read is not 401'd.
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });

  const returnTo = `/webinars/${slug}/room`;
  switch (access.kind) {
    case "auth":
      redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    // eslint-disable-next-line no-fallthrough -- redirect() throws; unreachable
    case "register":
    case "not-live":
      // Route to the 004/005 event page: the register front door (unregistered)
      // or the truthful lifecycle state (not-live). No room renders in either.
      redirect(`/webinars/${slug}`);
    // eslint-disable-next-line no-fallthrough -- redirect() throws; unreachable
    case "not-found":
      notFound();
  }

  // Granted — compose the room. The event context (school / title / speakers) is
  // the public 004 projection; a live event always has one.
  const event = await fetchPublicEventPage(slug);
  if (!event) notFound();

  const t = await getTranslations("room");
  const speakers = event.speakers.map((s) => s.name).join(" · ");

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {/* EARS-4 — the visibility-gated server-authoritative heartbeat loop. No
          rendered affordance; it POSTs a beat every N seconds while the tab is
          visible (N from the grant), capturing presence from mount. */}
      <PresenceHeartbeat
        slug={slug}
        intervalSeconds={access.config.heartbeatIntervalSeconds}
      />
      <RoomView
        config={access.config}
        context={{ school: event.school, title: event.title, speakers }}
        copy={{
          liveBadge: t("liveBadge"),
          onAir: t("onAir"),
          chatTab: t("chatTab"),
          infoTab: t("infoTab"),
          chatHeading: t("chatHeading"),
          moderatorPin: t("moderatorPin"),
          chatEmpty: t("chatEmpty"),
          composerPlaceholder: t("composerPlaceholder"),
          composerSend: t("composerSend"),
          unavailableTitle: t("unavailableTitle"),
          unavailableBody: t("unavailableBody"),
          playerTitle: t("playerTitle"),
          programNow: t("programNow"),
        }}
      />
    </main>
  );
}

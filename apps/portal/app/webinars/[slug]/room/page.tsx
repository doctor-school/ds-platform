import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  fetchMyDisplayName,
  fetchRoomConfig,
  resolveRoomEntry,
} from "@ds/room/server";
import { fetchPublicEventPage } from "../../../../lib/public-events";
import { buildRoomCopyStrings } from "./copy";
import { RoomClient } from "./room-client";
import { PORTAL_ROOM_ROUTES } from "./room-routes";

/**
 * 006 EARS-2 — the ACADEMY webinar-room route, `/webinars/:slug/room`.
 *
 * Since #1722 the room itself is the shared `@ds/room` unit (ADR-0013 A1): this
 * page is the academy's thin HOST projection over it and owns exactly four
 * things — the session forward, its own upstream base, its own route table and
 * its own copy. The composition, the transport and the entry resolution are the
 * shared unit's, identical on the doctor storefront.
 *
 * It consumes the EARS-1 server-side grant (it does NOT re-implement the gate)
 * and renders the room ONLY where the grant exists. `resolveRoomEntry` closes the
 * outcome set to render / redirect / not-found, so the three EARS-6 refusals
 * route TRUTHFULLY through the academy targets in {@link PORTAL_ROOM_ROUTES} —
 * the 003 login carrying a same-origin room `returnTo`, the 004/005 event page
 * with `?from=room`, and the bare event page for a non-live lifecycle — and the
 * page cannot fall through to rendering a room the gate refused.
 *
 * Only SERIALIZABLE props cross into the client (D14): the grant, the event
 * context, the plain copy strings and the route table. The functions the room
 * needs — `next/link`, the four ICU callbacks, `router.refresh` and the header
 * cluster — are built inside {@link RoomClient}. Rendered per request (the grant
 * is per-caller and the lifecycle changes), never statically prerendered.
 */
export const dynamic = "force-dynamic";

/** The same env-driven upstream every other portal server read uses. */
const API_BASE = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

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

  const routes = PORTAL_ROOM_ROUTES(slug);
  const access = await fetchRoomConfig(slug, session, { apiBase: API_BASE });
  const entry = resolveRoomEntry(access, routes.entry);
  if (entry.kind === "redirect") redirect(entry.href);
  if (entry.kind === "not-found") notFound();

  // Granted — compose the room. The event context (school / title / speakers) is
  // the public 004 projection; a live event always has one.
  const event = await fetchPublicEventPage(slug);
  if (!event) notFound();

  // 006 EARS-14/EARS-16 — the doctor's own saved name, a self-only read. `null`
  // routes the client wrapper to the JIT prompt instead of the room.
  const displayName = await fetchMyDisplayName(session, { apiBase: API_BASE });

  const t = await getTranslations("room");
  const tv = await getTranslations("errors.validation");

  return (
    <RoomClient
      slug={slug}
      config={entry.config}
      context={{
        school: event.school,
        title: event.title,
        speakers: event.speakers.map((s) => s.name).join(" · "),
      }}
      copy={buildRoomCopyStrings(
        (key) => t(key as never),
        (key) => tv(key as never),
      )}
      routes={routes.room}
      displayName={displayName}
    />
  );
}

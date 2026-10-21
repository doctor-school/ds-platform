import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { serverApiBase } from "@ds/auth-flow/server";
import {
  fetchPublicEventPage,
  forwardedSessionFrom,
} from "@ds/events-storefront/server";
import { ROOM_COPY_RU } from "@ds/room/copy";
import { buildRoomRouteTable } from "@ds/room/route-table";
import {
  fetchMyDisplayName,
  fetchRoomConfig,
  resolveRoomEntry,
} from "@ds/room/server";

import type { RoomPageHostConfig } from "../host-config";
import { RoomClient } from "./room-client";

export interface RoomPageProps {
  /** The mounting storefront's data-only room config (gate D9). */
  config: RoomPageHostConfig;
  /** The route's dynamic segment. */
  params: Promise<{ slug: string }>;
}

/**
 * 006 EARS-2 — the live-room route mount (wave-4 gate D9, rows 20–22, 24, 25).
 *
 * It consumes the EARS-1 server-side grant (it does NOT re-implement the gate)
 * and renders the room ONLY where the grant exists. `resolveRoomEntry` closes the
 * outcome set to render / redirect / not-found, so the three EARS-6 refusals
 * route TRUTHFULLY through the host's route table — its login carrying a
 * same-origin room `returnTo`, its event page with `?from=room`, and the bare
 * event page for a non-live lifecycle — and the page cannot fall through to
 * rendering a room the gate refused. A visitor with no session cookie is the
 * auth refusal of the shared read itself, which makes no api call (row 21).
 *
 * Both reads address `serverApiBase()` (D4), the one env-driven upstream every
 * server read of the storefronts uses.
 *
 * Only SERIALIZABLE props cross into the client (D14): the grant, the event
 * context, the plain copy strings (the RU default with the host's brand-home
 * label, row 24) and the in-room links. The functions the room needs are built
 * inside {@link RoomClient}.
 *
 * A host route file renders this with its host config and its `params`, and
 * declares `dynamic = "force-dynamic"` itself: the grant is per-caller and the
 * lifecycle changes, so the room is never statically prerendered.
 */
export async function RoomPage({ config, params }: RoomPageProps) {
  const { slug } = await params;

  const h = await headers();
  // The session is fingerprint-bound (ADR-0001 §6) — the shared builder carries
  // the same surface the browser bound at login, forwarded client address
  // included, so every authed server read is not 401'd (#2054).
  const session = forwardedSessionFrom(h);
  const apiBase = serverApiBase();

  const routes = buildRoomRouteTable(slug, config.routes);
  const access = await fetchRoomConfig(slug, session, { apiBase });
  const entry = resolveRoomEntry(access, routes.entry);
  if (entry.kind === "redirect") redirect(entry.href);
  if (entry.kind === "not-found") notFound();

  // Granted — compose the room. The event context (school / title / speakers) is
  // the host's public event projection; a live event always has one.
  const event = await fetchPublicEventPage(slug, config.eventRead, h);
  if (!event) notFound();

  // 006 EARS-14/EARS-16 — the doctor's own saved name, a self-only read. `null`
  // routes the client wrapper to the JIT prompt instead of the room.
  const displayName = await fetchMyDisplayName(session, { apiBase });

  return (
    <RoomClient
      slug={slug}
      config={entry.config}
      context={{
        school: event.school,
        title: event.title,
        speakers: event.speakers.map((s) => s.name).join(" · "),
      }}
      copy={{ ...ROOM_COPY_RU, brandHome: config.copy.brandHome }}
      routes={routes.room}
      displayName={displayName}
    />
  );
}

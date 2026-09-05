import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolveRoomEntry } from "@ds/room/server";
import { fetchDoctorEventPage } from "@/lib/event-page";
import { fetchDoctorDisplayName, fetchDoctorRoomConfig } from "@/lib/room";
import { forwardedSessionFrom } from "@/lib/session";
import { ROOM_COPY } from "./copy";
import { RoomClient } from "./room-client";
import { DOCTOR_ROOM_ROUTES } from "./room-routes";

/**
 * 006 EARS-2 · 020 §6.1 (#1722, slice 3) — `doctor.school/events/:slug/room`.
 *
 * The room itself is the shared `@ds/room` unit (ADR-0013 A1): this page is the
 * doctor storefront's thin HOST projection over it and owns exactly four things —
 * the session forward, its own upstream base (`lib/room.ts`), its own route table
 * (D10) and its own copy. The composition, the transport and the entry resolution
 * are the shared unit's, identical to the academy's mount.
 *
 * It CONSUMES the EARS-1 server-side grant and never re-implements the gate.
 * `resolveRoomEntry` closes the outcome set to render / redirect / not-found, so
 * the page cannot fall through to rendering a room the gate refused, and all
 * three EARS-6 refusals route through THIS host's targets — never an academy
 * login (D10 / ADR-0015 §4 REQ-24).
 *
 * D16a — a request carrying no session cookie is redirected BEFORE any upstream
 * read: `forwardedSessionFrom` returns `null` for an anonymous visitor, and
 * issuing a guaranteed-401 read on their behalf would only add a round trip.
 *
 * Only SERIALIZABLE props cross into the client (D14): the grant, the event
 * context, the plain copy strings and the route table. The functions the room
 * needs — `next/link`, the four ICU callbacks, `router.refresh` and the header
 * cluster — are built inside {@link RoomClient}.
 *
 * `force-dynamic` — the grant is per-caller and the lifecycle changes; a cached
 * room would serve one doctor's grant to everyone.
 */
export const dynamic = "force-dynamic";

export default async function DoctorRoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const routes = DOCTOR_ROOM_ROUTES(slug);

  // The session is fingerprint-bound (ADR-0001 §6) — the forwarded surface is
  // the cookie plus the two headers the browser bound at login.
  const session = forwardedSessionFrom(await headers());
  if (session === null) redirect(routes.entry.auth);

  const entry = resolveRoomEntry(
    await fetchDoctorRoomConfig(slug, session),
    routes.entry,
  );
  if (entry.kind === "redirect") redirect(entry.href);
  if (entry.kind === "not-found") notFound();

  // Granted — compose the room. The event context (school / title / speakers) is
  // this host's own storefront projection; a live event always has one.
  const event = await fetchDoctorEventPage(slug, await headers());
  if (!event) notFound();

  // 006 EARS-14 / EARS-16 — the doctor's own saved name, a self-only read.
  // `null` routes the client wrapper to the JIT prompt instead of the room.
  const displayName = await fetchDoctorDisplayName(session);

  return (
    <RoomClient
      slug={slug}
      config={entry.config}
      context={{
        school: event.school,
        title: event.title,
        speakers: event.speakers.map((speaker) => speaker.name).join(" · "),
      }}
      copy={ROOM_COPY}
      routes={routes.room}
      displayName={displayName}
    />
  );
}

import { RoomPage } from "@ds/room-page/page";

import { ACADEMY_ROOM_PAGE } from "../../../../lib/events-storefront.host-config";

/**
 * 006 EARS-2 — the Academy live room at `/webinars/:slug/room`, mounted from
 * `@ds/room-page` with the Academy host config (wave-4 gate §4 PR 4.3, D9). The
 * entry resolution, the refusal redirects, the reads, the client wrapper and its
 * copy live in the package.
 *
 * `dynamic` cannot live in the package, so it is declared here: the grant is
 * per-caller and the lifecycle changes, so the room is rendered per request and
 * never statically prerendered.
 */
export const dynamic = "force-dynamic";

export default async function WebinarRoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <RoomPage config={ACADEMY_ROOM_PAGE} params={params} />;
}

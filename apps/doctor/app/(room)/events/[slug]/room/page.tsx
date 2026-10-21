import { RoomPage } from "@ds/room-page/page";

import { DOCTOR_ROOM_PAGE } from "../../../../../lib/events-storefront.host-config";

/**
 * 006 EARS-2 — the doctor live room at `/events/:slug/room`, mounted from
 * `@ds/room-page` with the doctor host config (wave-4 gate §4 PR 4.4, D9). The
 * entry resolution, the refusal redirects, the reads, the client wrapper and its
 * copy live in the package.
 *
 * The `(room)` route group keeps the room out of the storefront chrome
 * (`app/(storefront)/layout.tsx`): the room is viewport-bounded and paints its
 * own header (D7).
 *
 * `dynamic` cannot live in the package, so it is declared here: the grant is
 * per-caller and the lifecycle changes, so the room is rendered per request and
 * never statically prerendered.
 */
export const dynamic = "force-dynamic";

export default async function DoctorRoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <RoomPage config={DOCTOR_ROOM_PAGE} params={params} />;
}

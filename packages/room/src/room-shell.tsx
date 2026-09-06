"use client";

import { useCallback, useMemo, useState } from "react";
import { createBrowserRoomApi } from "./client/room-api";
import type { RoomShellProps } from "./types";
import { PresenceHeartbeat } from "./ui/presence-heartbeat";
import { RoomHeaderBar } from "./ui/room-header-bar";
import { RoomPresenceProvider } from "./ui/room-presence";
import { RoomView } from "./ui/room-view";

/**
 * 006 EARS-11 — the whole gated room, as ONE host-agnostic composition.
 *
 * The shell is the seam both storefronts mount (ADR-0013 A1 / feature 020): the
 * host's SERVER page resolves entry, fetches its own event envelope and the
 * doctor's saved name, and its thin `"use client"` wrapper (D14) hands this
 * component the copy, the routes, its link component and its chrome cluster.
 * Everything below here is identical on both fronts — one implementation, no fork.
 *
 * The room is VIEWPORT-BOUNDED (#1123): the root fills the viewport height
 * (`h-dvh`) and clips its overflow, so the page itself never scrolls; the header
 * bar is `flex-none` and {@link RoomView} flexes to the remaining height, where the
 * chat ledger is the only scroll container.
 *
 * Composition, in mount order:
 * - {@link RoomPresenceProvider} — the client-shared live presence count (EARS-5),
 *   seeded by the EARS-1 grant, refreshed primarily by Centrifugo fan-out.
 * - {@link RoomHeaderBar} — the canvas header (EARS-2 / EARS-11 / EARS-12).
 * - {@link PresenceHeartbeat} — the visibility-gated capture loop (EARS-4); it
 *   renders nothing, and its ack is only a fallback for the count.
 * - {@link RoomView} — player + context strip + chat column (EARS-2 / EARS-3 /
 *   EARS-9 / EARS-18).
 *
 * The shell creates the room's ONE browser transport from the slug and passes it
 * down, so every `/v1` call the room makes has a single home (`./client/room-api`).
 */
export function RoomShell({
  slug,
  config,
  context,
  copy,
  routes,
  linkComponent,
  userCluster,
}: RoomShellProps) {
  const api = useMemo(() => createBrowserRoomApi({ slug }), [slug]);
  // 006 EARS-7 — the room's LIFECYCLE phase, lifted here because the close is one
  // fact three children must agree on (header pill, player region, chat composer).
  // It flips only on server proof — a gated request refused with the event no
  // longer `live` — never on a timer, and it is one-way: a room that has been told
  // the broadcast ended does not re-open itself (a new broadcast is a new grant).
  const [ended, setEnded] = useState(false);
  const onRoomClosed = useCallback(() => setEnded(true), []);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <RoomPresenceProvider initialCount={config.presenceCount}>
        <RoomHeaderBar
          routes={routes}
          liveAt={config.liveAt}
          copy={copy}
          linkComponent={linkComponent}
          userCluster={userCluster}
          ended={ended}
        />
        <PresenceHeartbeat
          api={api}
          intervalSeconds={config.heartbeatIntervalSeconds}
          onRoomClosed={onRoomClosed}
        />
        <RoomView
          api={api}
          config={config}
          context={context}
          copy={copy}
          ended={ended}
        />
      </RoomPresenceProvider>
    </main>
  );
}

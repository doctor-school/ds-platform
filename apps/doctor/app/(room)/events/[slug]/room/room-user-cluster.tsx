"use client";

import { Avatar } from "@ds/design-system/avatar";
import { initialsFromDisplayName } from "@ds/room/display-name";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * 006 EARS-12 / EARS-15 (#1722, slice 3) — the DOCTOR host's chrome cluster for
 * the room header's one `userCluster` slot.
 *
 * The shared room unit renders whatever node it is handed and knows nothing
 * about what is in it (D14a), so «which chrome does this storefront show in the
 * room header» is a host fact and lives here. The unit is the same two-button
 * shape both storefronts mount — theme toggle LEFT, initials chip RIGHTMOST
 * (owner directive 2026-07-23) — but it is BUILT here rather than imported from
 * the academy: an app-to-app import is forbidden (AGENTS.md §6), and the two
 * chips differ in kind, not only in style. The academy's chip is an icon-LINK to
 * `/account`; doctor.school mounts no profile route, so a link would be the dead
 * affordance 020 EARS-4 forbids. This one is therefore a NON-interactive labelled
 * chip.
 *
 * EARS-15 is the reason it exists at all: «where a gated doctor's room renders,
 * the room header shall display an avatar carrying the initials derived from that
 * doctor's real display name». The initials come from the saved display name the
 * SERVER page resolved and from nothing else — never an email local part, never a
 * placeholder. There is no «no name» branch here by construction: the EARS-14
 * gate in `room-client.tsx` renders the JIT name prompt INSTEAD of the room while
 * the name is `null`, so the room — and this cluster — only ever composes once a
 * real name exists. A fabricated avatar is unreachable rather than merely
 * unwritten.
 *
 * The chip itself is the DS {@link Avatar} primitive (canvas §05 «Аватар ·
 * инициалы», 40×40 square, token-only) — adopted, not hand-assembled (ADR-0013).
 */
export interface RoomUserClusterProps {
  /** The doctor's saved display name — never `null` where the room renders. */
  displayName: string;
  /** The accessible name for the chip (`copy.avatarLabel(displayName)`). */
  avatarLabel: string;
}

export function RoomUserCluster({
  displayName,
  avatarLabel,
}: RoomUserClusterProps) {
  return (
    // `order-first layout:order-none` is the SLOT's class (the shared header
    // re-seats the injected node before the mobile ✕ and keeps it last on
    // desktop), so it stays on the outer node the room receives.
    <div className="flex flex-none items-center gap-2.5 order-first layout:order-none">
      <ThemeToggle />
      <Avatar
        aria-label={avatarLabel}
        title={avatarLabel}
        data-testid="room-avatar"
      >
        {initialsFromDisplayName(displayName)}
      </Avatar>
    </div>
  );
}

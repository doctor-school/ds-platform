"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DisplayNamePrompt,
  ROOM_FORMATTERS_RU,
  RoomShell,
  createBrowserRoomApi,
  type RoomCopy,
  type RoomShellServerProps,
} from "@ds/room";
import { initialsFromDisplayName } from "@ds/room/display-name";
import { HeaderUserCluster } from "@ds/storefront-shell/user-cluster";

/**
 * 006 EARS-11 / EARS-14 — the room's `"use client"` wrapper over the shared room
 * unit (wave-4 gate row 25, #1722 D14).
 *
 * The server page ({@link RoomPage}) resolves entry, fetches the event envelope
 * and the doctor's saved name, and hands this component SERIALIZABLE props only.
 * Everything a function or a React element — the four RU formatters, `next/link`
 * (D7), `router.refresh` and the shell's header cluster (D17a) — is constructed
 * HERE, on the client side of the RSC boundary, because none of it can cross it.
 *
 * It also owns the EARS-14 branch: with no saved display name the shared prompt
 * is rendered INSTEAD of the room (a pre-render gate, not a fourth admission
 * condition), and on save `router.refresh()` re-runs the server page, which then
 * reads a non-null name and composes the room.
 */
export interface RoomClientProps extends Omit<
  RoomShellServerProps,
  "displayName"
> {
  /** The doctor's saved display name, or `null` → the EARS-14 JIT prompt. */
  displayName: string | null;
}

export function RoomClient({
  slug,
  config,
  context,
  copy,
  routes,
  displayName,
}: RoomClientProps) {
  const router = useRouter();

  // The room's ONE browser transport — the prompt branch needs it before the
  // shell exists, so the wrapper (not the shell) is where it is created for that
  // path; the shell builds its own from the same slug once the room composes.
  const api = useMemo(() => createBrowserRoomApi({ slug }), [slug]);

  // D22 — the four parameterised values take live client state as arguments (a
  // presence push, the elapsed live minutes, the doctor's own name, an unread
  // tally), so they are FUNCTIONS and cannot be pre-rendered server-side.
  const roomCopy: RoomCopy = useMemo(
    () => ({ ...copy, ...ROOM_FORMATTERS_RU }),
    [copy],
  );

  // 006 EARS-14 — the JIT «Имя и фамилия» step. The name persists, then the
  // server page re-renders with it and the room composes on the next pass.
  if (displayName === null) {
    return (
      <DisplayNamePrompt
        copy={copy}
        api={api}
        onSaved={() => router.refresh()}
      />
    );
  }

  return (
    <RoomShell
      slug={slug}
      config={config}
      context={context}
      copy={roomCopy}
      routes={routes}
      displayName={displayName}
      linkComponent={Link}
      userCluster={
        // 006 EARS-12 / EARS-15 — the storefront chrome: the theme toggle plus
        // the doctor's initials chip, the SAME `HeaderUserCluster` the shell
        // header mounts (owner directive 2026-07-23 — one presentation source of
        // truth, toggle LEFT, chip RIGHTMOST). The room unit renders this node
        // verbatim in its one chrome slot. The initials come ONLY from the real
        // saved name — the prompt branch above guarantees there is one.
        <HeaderUserCluster
          className="order-first gap-5 layout:order-none"
          themeToggleLabels={{
            toDark: copy.themeToggle,
            toLight: copy.themeToggle,
          }}
          profileLabel={roomCopy.avatarLabel(displayName)}
          initials={initialsFromDisplayName(displayName)}
          profileTestId="room-avatar"
          profileClassName="hidden layout:inline-flex"
        />
      }
    />
  );
}

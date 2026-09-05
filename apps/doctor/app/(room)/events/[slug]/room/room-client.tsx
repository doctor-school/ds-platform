"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DisplayNamePrompt,
  RoomShell,
  createBrowserRoomApi,
  type RoomCopy,
  type RoomShellServerProps,
} from "@ds/room";
import { RoomUserCluster } from "./room-user-cluster";

/**
 * 006 EARS-11 / EARS-14 · 020 §6.1 (#1722, slice 3) — the DOCTOR host's
 * `"use client"` wrapper over the shared room unit (D14).
 *
 * The server page resolves entry, fetches the event envelope and the doctor's
 * saved name, and hands this component SERIALIZABLE props only. Everything that
 * is a function or a React element — the four ICU callbacks, `next/link` (D7),
 * `router.refresh` and this host's chrome cluster (D17a) — is constructed HERE,
 * because none of it can cross the RSC boundary.
 *
 * Two differences from the academy wrapper, both host-owned by design:
 * - the ICU values are resolved with `Intl.PluralRules("ru-RU")` rather than
 *   `next-intl`, because this app has no catalogue and no provider (the copy is
 *   an inline const — see `copy.ts`); the plural CATEGORIES are the same ones the
 *   academy's ICU messages select on, so the two rooms read identically;
 * - `userCluster` is this host's own {@link RoomUserCluster} — the storefront
 *   theme toggle plus the EARS-15 initials chip. The chip is a NON-link here
 *   (doctor.school mounts no profile route, so a link would be a dead
 *   affordance), which is the one way it differs from the academy's cluster.
 *
 * It also owns the EARS-14 branch: with no saved display name the shared prompt
 * renders INSTEAD of the room (a pre-render gate, not a fourth admission
 * condition), and on save `router.refresh()` re-runs the server page, which then
 * reads a non-null name and composes the room.
 */
export interface RoomClientProps extends Omit<RoomShellServerProps, "displayName"> {
  /** The doctor's saved display name, or `null` → the EARS-14 JIT prompt. */
  displayName: string | null;
}

/** RU plural categories, resolved once per module rather than per render. */
const RU_PLURAL = new Intl.PluralRules("ru-RU");

/** «N врачей в комнате» — the same four forms the academy catalogue declares. */
function doctorsInRoom(count: number): string {
  switch (RU_PLURAL.select(count)) {
    case "one":
      return `${count} врач в комнате`;
    case "few":
      return `${count} врача в комнате`;
    default:
      return `${count} врачей в комнате`;
  }
}

/** «N новых сообщений» — the collapsed-chat unread tally. */
function unreadMessages(count: number): string {
  switch (RU_PLURAL.select(count)) {
    case "one":
      return `${count} новое сообщение`;
    case "few":
      return `${count} новых сообщения`;
    default:
      return `${count} новых сообщений`;
  }
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

  // The room's ONE browser transport. Memoised on the slug: `room-chat` and
  // `presence-heartbeat` key their effects on this instance, so a fresh object
  // per render would tear down and re-establish the Centrifugo connection on
  // every render pass. The prompt branch needs it before the shell exists, so the
  // wrapper is where it is created for that path.
  const api = useMemo(() => createBrowserRoomApi({ slug }), [slug]);

  // D22 — the four ICU-parameterised values take live client state as arguments
  // (a presence push, the elapsed live minutes, the doctor's own name, an unread
  // tally), so they are FUNCTIONS and cannot be pre-rendered server-side.
  const roomCopy: RoomCopy = useMemo(
    () => ({
      ...copy,
      presenceCount: doctorsInRoom,
      liveDuration: (minutes: number) => `· ${minutes} мин`,
      avatarLabel: (name: string) => `Ваш профиль: ${name}`,
      chatUnread: unreadMessages,
    }),
    [copy],
  );

  // 006 EARS-14 — the JIT «Имя и фамилия» step. The name persists, then the
  // server page re-renders with it and the room composes on the next pass.
  if (displayName === null) {
    return (
      <DisplayNamePrompt copy={copy} api={api} onSaved={() => router.refresh()} />
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
        // 006 EARS-12 / EARS-15 — this host's own chrome in the one slot the shell
        // offers: the 017 storefront theme toggle (the SAME control its header
        // mounts, so the room's header cannot drift from the storefront's) plus
        // the initials chip built from the doctor's REAL saved name. The `null`
        // name never reaches here — the EARS-14 prompt above returns first.
        <RoomUserCluster
          displayName={displayName}
          avatarLabel={roomCopy.avatarLabel(displayName)}
        />
      }
    />
  );
}

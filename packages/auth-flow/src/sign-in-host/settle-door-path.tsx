"use client";

import { useEffect } from "react";

import type { SignInHostPageDoor } from "../server/sign-in-host";

/**
 * 003 EARS-71 (door stability, lead decision) — Zitadel lands every auth
 * request on the host's `/login`, and which door renders there comes from the
 * one-shot entry intent (registration for `prompt=create`, the reset door, …).
 * The intent is spent on that first read, so a reload, Back or Forward of the
 * `/login` address would re-render the plain sign-in door.
 *
 * Once the door has rendered, this replaces the CURRENT history entry's path
 * with the door's own (`/register`, `/reset`, …), keeping the query (the auth
 * request) and the hash: no new history entry, no navigation, no request. A
 * later reload / Back / Forward re-enters the door route itself, whose path
 * fixes the door (`doorFor`), while the intent stays spent. A door already on
 * its own path is left untouched.
 */
export function SettleDoorPath({ door }: { door: SignInHostPageDoor }): null {
  useEffect(() => {
    const path = `/${door}`;
    const { pathname, search, hash } = window.location;
    if (pathname === path) return;
    settleAddress(path + search + hash);
  }, [door]);
  return null;
}

/**
 * Replace the CURRENT history entry's address with `href` — no new entry, no
 * navigation, no request — so a later reload / Back / Forward re-enters the
 * door that address names: the door path above. The host's other history
 * moves (door hops, the code step's own entry, leaving) live in
 * `host-history.ts`.
 */
export function settleAddress(href: string): void {
  window.history.replaceState(window.history.state, "", href);
}

"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isHiddenPath } from "@ds/storefront-shell";

/**
 * #2664 — the Academy's ONE `<main>` landmark, owned by the root layout.
 *
 * The rule on both storefronts: the route group's shell owns the page's one
 * `<main>`; package compositions, design-system blocks and pages render none.
 * The doctor storefront scopes its shells by route group. The Academy has a
 * single root layout over every route, so this is where its `<main>` lives —
 * with one exception: the webinar room, whose `RoomShell` IS the room's shell
 * and opens its own `<main>`. On those paths the frame stays a plain `<div>` so
 * the room's landmark is the only one and stays top-level.
 *
 * A client boundary for the same reason as the chrome's `VisibleOffPaths`
 * (`@ds/storefront-shell`): the root layout does not re-render on a soft
 * navigation, so the pathname is read where it stays current.
 */
export function RouteMain({
  roomShellPaths,
  className,
  children,
}: {
  roomShellPaths: readonly string[];
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return isHiddenPath(pathname, roomShellPaths) ? (
    <div className={className}>{children}</div>
  ) : (
    <main className={className}>{children}</main>
  );
}

"use client";

import type { MouseEvent, ReactNode } from "react";

import { hopHostDoor } from "./host-history";

/**
 * 003 EARS-70 / EARS-71 — a link between the sign-in host's doors. A plain
 * anchor, never a Next router link: the host proxy answers a door only for a
 * top-level navigation (any other request is a 403), so a router link's
 * background RSC prefetch and its client-side navigation are both refused.
 * A plain activation hops by replacing the host's history entry
 * (`hopHostDoor`); a modified click (new tab, new window) keeps the browser's
 * own handling.
 */
export function DoorLink({
  href,
  children,
  className,
  "data-testid": testId,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    hopHostDoor(href);
  }
  return (
    <a href={href} onClick={onClick} className={className} data-testid={testId}>
      {children}
    </a>
  );
}

/** The `renderLink` the design-system cards take, on the sign-in host. */
export function renderDoorLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}): ReactNode {
  return <DoorLink href={href}>{children}</DoorLink>;
}

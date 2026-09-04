import type { ComponentType, ReactNode } from "react";
import type { RoomConfig } from "@ds/schemas";

import type { RoomCopy, RoomCopyStrings } from "./copy/room-copy";

/**
 * 006 / 020 — the host-injection contract of the shared room unit.
 *
 * The room is hosted by two storefronts with different routes, different copy
 * catalogues and different session plumbing. Everything that differs crosses this
 * boundary as a PROP; nothing in the package reads a host module, a framework
 * catalogue or an environment variable (`./purity.test.ts`).
 *
 * The split between the two prop shapes is the RSC boundary (D14): a server
 * component may pass {@link RoomShellServerProps} — plain data only — while the
 * callbacks, the link component and the user cluster are constructed by each
 * host's own `"use client"` wrapper. Passing a function from a server component
 * throws «Functions cannot be passed directly to Client Components» at first
 * render, so this is a contract, not a style preference.
 */

/** The event context strip — the host's OWN public-event projection (EARS-2). */
export interface RoomContext {
  school: string;
  title: string;
  speakers: string;
}

/** The two host-owned room routes the composition links to. */
export interface RoomRoutes {
  /** The brand-home target of the header wordmark (эфиры list). */
  brandHome: string;
  /** The truthful exit target — the host's own event page. */
  eventPage: string;
}

/**
 * D7 — the host's link component. It defaults to a plain `<a>` so the package
 * never hardcodes a router, and BOTH hosts pass `next/link` so client-side
 * navigation and prefetch survive the extraction.
 */
export type RoomLinkComponent = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
}>;

/** SERIALIZABLE — exactly what a host's SERVER component may pass (D14). */
export interface RoomShellServerProps {
  slug: string;
  /** The EARS-1 grant, verbatim from `@ds/schemas`. */
  config: RoomConfig;
  /** Host-fetched from its own public-event envelope. */
  context: RoomContext;
  /** The doctor's REAL saved display name (EARS-15) — never a placeholder. */
  displayName: string;
  copy: RoomCopyStrings;
  routes: RoomRoutes;
}

/** CLIENT-ONLY — supplied by the per-host `"use client"` wrapper (D14). */
export interface RoomShellProps extends RoomShellServerProps {
  /** The strings PLUS the four ICU callbacks the wrapper built. */
  copy: RoomCopy;
  /** Default: a plain `<a>`; both hosts pass `next/link` (D7). */
  linkComponent?: RoomLinkComponent;
  /** The one chrome slot — the host's theme toggle + profile chip (D17a). */
  userCluster?: ReactNode;
}

export type {
  RoomCopy,
  RoomCopyStrings,
  RoomDisplayNamePromptCopy,
  RoomValidationCopy,
} from "./copy/room-copy";

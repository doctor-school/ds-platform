"use client";

import type { ReactNode } from "react";
import { Badge } from "@ds/design-system/badge";
import { Link as DsLink } from "@ds/design-system/link";
import type { RoomCopy, RoomLinkComponent, RoomRoutes } from "../types";
import { LiveDuration, PresenceCount } from "./room-presence";

/**
 * 006 EARS-2 / EARS-5 / EARS-11 / EARS-12 — the room's top app-header bar,
 * rendered atop the gated room composition to the vendored `webinar-room.dc.html`
 * header geometry (lines 14-30, ADR-0013 canvas-wins). A full-width `header`-token
 * blue brand bar with a 2px bottom border: LEFT a "Doctor.School" wordmark linking
 * to the host's эфиры list (the canvas logo → `routes.brandHome`) plus the reused DS
 * {@link Badge} `live` pill — «В эфире» with the live «· N мин» duration suffix
 * ({@link LiveDuration}); RIGHT (desktop) the «N врачей в комнате» live presence
 * count ({@link PresenceCount}) beside a single truthful exit link back to the
 * host's own event page (mobile collapses the count away and shows a compact ✕
 * glyph), plus the host's own chrome cluster in the `userCluster` slot.
 *
 * #690 realized the two data-backed canvas header elements #584 deferred: the live
 * presence count (a server-side aggregate over the append-only beats, EARS-5) and
 * the live-duration suffix (from the actual go-live instant `liveAt`, EARS-10).
 *
 * **Host-injected chrome (D14a / D17a, #1722).** The theme toggle + doctor avatar
 * (EARS-12 / EARS-15) are the host's own app-shell unit, so the room takes them as
 * ONE `userCluster` node instead of importing a host component: each storefront
 * mounts the SAME two-button cluster its shell header mounts, built from
 * `copy.themeToggle` + `copy.avatarLabel(displayName)` and the package's own
 * `initialsFromDisplayName` (`@ds/room/display-name`, D17). Initials therefore come
 * ONLY from the doctor's REAL saved display name (EARS-15) — with no name the host
 * renders the JIT prompt INSTEAD of the room, and with no cluster injected the
 * header paints no avatar at all rather than fabricating one from an
 * email/placeholder, the value #584 refused to fake.
 *
 * The bar became a client component (D14a): it composes the client-side live
 * indicators, and a server parent may not pass them a callback across the RSC
 * boundary.
 *
 * All copy is INJECTED (EARS-10) — no hardcoded user-facing string and no
 * catalogue read lives here.
 */
export interface RoomHeaderBarProps {
  /** The host's room routes — the wordmark target and the truthful exit target. */
  routes: RoomRoutes;
  /** The actual go-live instant (EARS-1 grant `liveAt`); `null` → no «· N мин» suffix. */
  liveAt: string | null;
  copy: RoomCopy;
  /** D7 — the host's link component; defaults to a plain anchor. */
  linkComponent?: RoomLinkComponent | undefined;
  /** The one chrome slot: the host's theme toggle + profile chip (D17a). */
  userCluster?: ReactNode | undefined;
}

/** The D7 default — a plain anchor, so the package hardcodes no router. */
const PlainAnchor: RoomLinkComponent = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

export function RoomHeaderBar({
  routes,
  liveAt,
  copy,
  linkComponent,
  userCluster,
}: RoomHeaderBarProps) {
  const LinkImpl = linkComponent ?? PlainAnchor;
  return (
    <header className="flex flex-none items-center justify-between gap-3 border-b-2 border-border bg-header px-4 py-3 text-header-foreground layout:px-10">
      {/* Mobile gap = the canvas `headGap` 10px (desktop 24px group rhythm keeps
          the shipped gap-4); `overflow-hidden` realizes the canvas `min-width:0`
          intent — when the live pill outgrows a narrow viewport it clips at the
          group boundary instead of painting under the right-group controls. */}
      <div className="flex min-w-0 items-center gap-2.5 overflow-hidden layout:gap-4">
        {/* The canvas logo routes to the host's эфиры list — the wordmark is the
            brand home affordance, labelled for assistive tech (the visual is the
            copy). The interaction states (hover + focus ring) are owned by the DS
            `Link` primitive via `asChild`; the header-foreground colour + wordmark
            weight override its brand-blue default (ADR-0013 §7 / no raw styled link). */}
        <DsLink
          asChild
          className="text-base font-extrabold tracking-tight text-header-foreground layout:text-lg"
        >
          <LinkImpl href={routes.brandHome} aria-label={copy.brandHome}>
            Doctor.School
          </LinkImpl>
        </DsLink>
        {/* The reused live pill — «В эфире» plus the live «· N мин» duration counted
            from the real go-live instant (EARS-5/EARS-10). The suffix renders inside
            the pill so it inherits the badge's uppercase micro-type, matching the
            canvas «В ЭФИРЕ · 24 МИН». A null `liveAt` renders «В эфире» alone.
            The suffix is DESKTOP-ONLY (same collapse rule as the presence count):
            with the #702 theme toggle in the right group, wordmark + full pill +
            toggle + ✕ physically exceed a 390px viewport (the canvas mock's own
            metrics only fit from ~430px), so the narrow render keeps the truthful
            «В эфире» pill whole rather than clipping the minute tail mid-glyph. */}
        <Badge variant="live" className="whitespace-nowrap">
          {copy.liveBadge}
          <span className="hidden layout:inline">
            <LiveDuration liveAt={liveAt} format={copy.liveDuration} />
          </span>
        </Badge>
      </div>
      <div className="flex flex-none items-center gap-2.5 layout:gap-5">
        {/* The live «N врачей в комнате» presence count (canvas line 21) — desktop
            only. The server aggregate is seeded by the room grant, refreshed
            primarily by Centrifugo fan-out, with heartbeat acks as a best-effort
            fallback (EARS-5); never per-doctor PII. Plain white `header-foreground` on the `bg-header`
            band (canvas layout, no plate) — AA-clean because the band is now the
            accessible blue.700 (white = 8.14:1), deepened from blue.500 for #713. */}
        <PresenceCount
          className="hidden text-sm font-bold text-header-foreground layout:inline"
          format={copy.presenceCount}
        />
        {/* The truthful exit target — the host's own event page (never a soft
            close). One link, two visual variants: a desktop labelled text and a
            mobile compact ✕ glyph (aria-hidden — the anchor's aria-label carries the
            accessible name). DS `Link` owns hover + focus; header-foreground
            overrides blue. */}
        <DsLink asChild className="flex-none text-header-foreground">
          <LinkImpl href={routes.eventPage} aria-label={copy.exit}>
            <span className="hidden text-sm font-bold underline decoration-2 underline-offset-4 layout:inline">
              {copy.exit}
            </span>
            <span
              aria-hidden="true"
              className="inline-flex size-11 items-center justify-center border-2 border-border bg-card text-lg font-extrabold text-card-foreground shadow-md layout:hidden"
            >
              ✕
            </span>
          </LinkImpl>
        </DsLink>
        {/* 006 EARS-12 / EARS-15 — the host's theme toggle + initials profile chip,
            injected as ONE node (owner directive 2026-07-23: the same two-button
            unit everywhere — toggle LEFT, chip RIGHTMOST, one presentation source
            of truth). `order-first` on the injected node re-seats the cluster
            before the mobile ✕ (canvas mobile order: toggle → ✕) while desktop
            keeps it last (exit → toggle → chip); that class is the host's to pass,
            because the cluster is the host's element. */}
        {userCluster}
      </div>
    </header>
  );
}

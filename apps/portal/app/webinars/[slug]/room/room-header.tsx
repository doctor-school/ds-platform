import Link from "next/link";
import { Badge } from "@ds/design-system/badge";
import { Link as DsLink } from "@ds/design-system/link";

/**
 * 006 EARS-2 / EARS-11 — the room's top app-header bar, rendered atop the gated
 * room composition to the vendored `webinar-room.dc.html` header geometry (lines
 * 14-30, ADR-0013 canvas-wins). A full-width `header`-token blue brand bar with a
 * 2px bottom border: LEFT a "Doctor.School" wordmark linking to the эфиры list
 * (the canvas logo → `/webinars`) plus the reused DS {@link Badge} `live` pill
 * (the same red pulsing indicator the event poster + player already render —
 * adopted, not rebuilt); RIGHT a single truthful exit link back to the 004 event
 * page, carrying both a desktop labelled affordance and a mobile compact ✕ glyph.
 *
 * Deferred as tracked decision-debt (each needs live infra this integration slice
 * does not own — the lead files the follow-ups, never faked here with a
 * placeholder value): the canvas theme-toggle button, the "N врачей в комнате"
 * live presence count, the doctor avatar, and the "· N мин" live-duration suffix
 * on the pill.
 *
 * All copy is injected from the message catalog (EARS-10) — no hardcoded
 * user-facing string lives here; the parent {@link RoomPage} reads the strings via
 * `getTranslations("room")` and passes them down as {@link RoomHeaderCopy}.
 */
export interface RoomHeaderCopy {
  brandHome: string;
  liveBadge: string;
  exit: string;
}

export function RoomHeader({
  eventHref,
  copy,
}: {
  eventHref: string;
  copy: RoomHeaderCopy;
}) {
  return (
    <header className="flex flex-none items-center justify-between border-b-2 border-border bg-header px-4 py-3 text-header-foreground layout:px-10">
      <div className="flex min-w-0 items-center gap-4">
        {/* The canvas logo routes to the эфиры list — the wordmark is the brand
            home affordance, labelled for assistive tech (the visual is the copy).
            The interaction states (hover + focus ring) are owned by the DS `Link`
            primitive via `asChild`; the header-foreground colour + wordmark weight
            override its brand-blue default (ADR-0013 §7 / no raw styled link). */}
        <DsLink
          asChild
          className="text-lg font-extrabold tracking-tight text-header-foreground"
        >
          <Link href="/webinars" aria-label={copy.brandHome}>
            Doctor.School
          </Link>
        </DsLink>
        <Badge variant="live">{copy.liveBadge}</Badge>
      </div>
      {/* The truthful exit target — the 004 event page (never a soft close). One
          link, two visual variants: a desktop labelled text and a mobile compact
          ✕ glyph (aria-hidden — the anchor's aria-label carries the accessible
          name). DS `Link` owns hover + focus; header-foreground overrides blue. */}
      <DsLink asChild className="flex-none text-header-foreground">
        <Link href={eventHref} aria-label={copy.exit}>
          <span className="hidden text-sm font-bold underline decoration-2 underline-offset-4 layout:inline">
            {copy.exit}
          </span>
          <span
            aria-hidden="true"
            className="inline-flex size-11 items-center justify-center border-2 border-border bg-card text-lg font-extrabold text-card-foreground shadow-md layout:hidden"
          >
            ✕
          </span>
        </Link>
      </DsLink>
    </header>
  );
}

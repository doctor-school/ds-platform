import Link from "next/link";
import { Badge } from "@ds/design-system/badge";
import { Link as DsLink } from "@ds/design-system/link";
import { LiveDuration, PresenceCount } from "./room-presence";
import { ThemeToggle } from "./theme-toggle";

/**
 * 006 EARS-2 / EARS-5 / EARS-11 / EARS-12 — the room's top app-header bar,
 * rendered atop the gated room composition to the vendored `webinar-room.dc.html`
 * header geometry (lines 14-30, ADR-0013 canvas-wins). A full-width `header`-token
 * blue brand bar with a 2px bottom border: LEFT a "Doctor.School" wordmark linking
 * to the эфиры list (the canvas logo → `/webinars`) plus the reused DS
 * {@link Badge} `live` pill — «В эфире» with the live «· N мин» duration suffix
 * ({@link LiveDuration}); RIGHT (desktop) the «N врачей в комнате» live presence
 * count ({@link PresenceCount}) beside a single truthful exit link back to the 004
 * event page (mobile collapses the count away and shows a compact ✕ glyph), plus
 * the light/dark **theme toggle** ({@link ThemeToggle}, both breakpoints — the
 * portal's ONLY visible theme control until #510; the portal-wide mechanism it
 * drives lives in `lib/theme.ts` + the root layout's FOUC guard).
 *
 * #690 realized the two data-backed canvas header elements #584 deferred: the live
 * presence count (a server-side aggregate over the append-only beats, EARS-5) and
 * the live-duration suffix (from the actual go-live instant `liveAt`, EARS-10).
 * One canvas header element remains deferred, needing infra this surface does not
 * own — an omission, never a dead affordance:
 *   • the **doctor avatar** (initials) — re-deferred: 003 self-service registration
 *     collects NO name (the Zitadel profile is a placeholder never surfaced, and
 *     the `users` mirror has no name column), so there is no real display name to
 *     project. Fabricating initials from the email would be a faked value — exactly
 *     what #584 refused. Blocked on a session display-name projection (its own
 *     Issue), never faked here.
 *
 * All copy is injected from the message catalog (EARS-10) — no hardcoded
 * user-facing string lives here; the parent {@link RoomPage} reads the strings via
 * `getTranslations("room")` and passes them down as {@link RoomHeaderCopy}, and the
 * live indicators resolve their pluralized copy through the same catalog.
 */
export interface RoomHeaderCopy {
  brandHome: string;
  liveBadge: string;
  exit: string;
  /** The theme toggle's accessible name («Переключить тему», EARS-12). */
  themeToggle: string;
}

export function RoomHeader({
  eventHref,
  liveAt,
  copy,
}: {
  eventHref: string;
  /** The actual go-live instant (EARS-1 grant `liveAt`); `null` → no «· N мин» suffix. */
  liveAt: string | null;
  copy: RoomHeaderCopy;
}) {
  return (
    <header className="flex flex-none items-center justify-between gap-3 border-b-2 border-border bg-header px-4 py-3 text-header-foreground layout:px-10">
      {/* Mobile gap = the canvas `headGap` 10px (desktop 24px group rhythm keeps
          the shipped gap-4); `overflow-hidden` realizes the canvas `min-width:0`
          intent — when the live pill outgrows a narrow viewport it clips at the
          group boundary instead of painting under the right-group controls. */}
      <div className="flex min-w-0 items-center gap-2.5 overflow-hidden layout:gap-4">
        {/* The canvas logo routes to the эфиры list — the wordmark is the brand
            home affordance, labelled for assistive tech (the visual is the copy).
            The interaction states (hover + focus ring) are owned by the DS `Link`
            primitive via `asChild`; the header-foreground colour + wordmark weight
            override its brand-blue default (ADR-0013 §7 / no raw styled link). */}
        <DsLink
          asChild
          className="text-base font-extrabold tracking-tight text-header-foreground layout:text-lg"
        >
          <Link href="/webinars" aria-label={copy.brandHome}>
            Doctor.School
          </Link>
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
            <LiveDuration liveAt={liveAt} />
          </span>
        </Badge>
      </div>
      <div className="flex flex-none items-center gap-2.5 layout:gap-5">
        {/* The live «N врачей в комнате» presence count (canvas line 21) — desktop
            only. A server-side aggregate refreshed by the heartbeat loop (EARS-5),
            never per-doctor PII. The canvas tints this a muted light-blue (#AED4FB);
            we render it full-strength `header-foreground` to match the sibling exit
            link and stay AA-clean (the exact muted-header tint needs a dedicated
            token, deferred with the dark-theme work at #702 — no opacity-dimmed
            foreground token, ADR-0013 §7). */}
        <PresenceCount className="hidden text-sm font-bold text-header-foreground layout:inline" />
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
        {/* 006 EARS-12 — the light/dark theme toggle (canvas line 25), the DS
            `switch.tsx` primitive per design §7 (adopt-before-bespoke). Renders on
            BOTH breakpoints like the canvas control; `order-first` re-seats it
            before the mobile ✕ (canvas mobile order: toggle → ✕) while desktop
            keeps it last in the group (canvas desktop order: exit → toggle). It
            flips `.dark` on <html> and persists the explicit `ds-theme` choice —
            the portal's only visible theme control until #510. */}
        <ThemeToggle
          label={copy.themeToggle}
          className="order-first layout:order-none"
        />
      </div>
    </header>
  );
}

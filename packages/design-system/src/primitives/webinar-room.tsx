"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist WEBINAR ROOM layout (006 EARS-2 / EARS-11, source
 * `design-source/webinar-room.dc.html`). The composition shell the room surface
 * fills: the player, the event context, and the chat aside laid out to the canvas
 * geometry — desktop a `1fr 400px` grid (player + context left, chat aside
 * right); mobile a full-bleed player, a slim "what's on air" bar, then a Чат / О
 * эфире tab strip (the canvas's Вопросы tab is the wave-2 deferral, design §8.1).
 *
 * Off-scale canvas geometry lives HERE, in the design-system SoT, not in app
 * code: the `1fr 400px` desktop grid track and the `1600px` max width are
 * computed dimensions the app-scoped `no-arbitrary-tailwind-value` gate forbids in
 * `apps/*` (its SCOPE note exempts the DS component layer). Colour + type flow
 * through tokens → light/dark flips automatically; borders are 2px, elevation is
 * the `6px 6px 0` cast (`shadow-lg`), matching {@link WebinarStatusCard}.
 *
 * The desktop and mobile trees are rendered EXCLUSIVELY (a media-query switch,
 * mirroring the canvas's `isMobile`/`isDesktop`) so the player — and its embed
 * iframe — mounts EXACTLY ONCE per breakpoint (never two concurrent stream
 * frames). It renders the desktop tree during SSR + first paint, then flips on
 * mount; the effect runs after hydration, so there is no hydration mismatch.
 *
 * ALL user-facing copy is injected (EARS-10): the tab labels are resolved by the
 * app through the message catalog and passed in — no string is hardcoded here.
 */
export interface WebinarRoomLayoutProps {
  /** The embed player frame (the sole owner of the stream iframe). */
  player: React.ReactNode;
  /** The event context: school eyebrow, title, speakers, "now on air" pointer. */
  context: React.ReactNode;
  /** The chat aside composition shell (behaviour is EARS-3). */
  chat: React.ReactNode;
  /** The mobile "what's on air" slim bar shown under the full-bleed player. */
  slimBar?: React.ReactNode;
  /** Mobile Чат tab label (from the catalog). */
  chatTabLabel: string;
  /** Mobile О эфире tab label (from the catalog). */
  infoTabLabel: string;
}

const LAYOUT_QUERY = "(min-width: 56.3125rem)";

/** `true` at/above the `layout` breakpoint (SSR/first-paint default = desktop). */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(true);
  React.useEffect(() => {
    const mq = window.matchMedia(LAYOUT_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

function TabButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // Active = the filled primary tab (the proven button fill/fg combo, AA);
        // inactive = the card surface with card-safe primary-action text (blue.700,
        // never text-primary blue.500 — the #270 card-contrast precedent).
        // Interaction states (ADR-0013 §7 layer 2): token-only hover + a visible
        // keyboard focus ring (`shadow-focus`), never a raw value.
        "px-1.5 py-3 text-center text-sm font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:shadow-focus",
        active
          ? "bg-primary-action text-primary-foreground font-extrabold hover:bg-primary-hover"
          : "bg-card text-primary-action hover:bg-tint",
        className,
      )}
    >
      {children}
    </button>
  );
}

const WebinarRoomLayout = React.forwardRef<
  HTMLDivElement,
  WebinarRoomLayoutProps & React.ComponentPropsWithoutRef<"div">
>(
  (
    {
      player,
      context,
      chat,
      slimBar,
      chatTabLabel,
      infoTabLabel,
      className,
      ...props
    },
    ref,
  ) => {
    const isDesktop = useIsDesktop();
    const [mobileTab, setMobileTab] = React.useState<"chat" | "info">("chat");

    if (isDesktop) {
      return (
        <div
          ref={ref}
          className={cn(
            "mx-auto grid w-full max-w-[1600px] grid-cols-[1fr_400px] gap-8 box-border px-10 pt-8 pb-10",
            className,
          )}
          {...props}
        >
          <div className="min-w-0">
            {player}
            <div className="mt-6">{context}</div>
          </div>
          <aside className="flex min-h-0 flex-col border-2 border-border bg-card text-card-foreground shadow-lg">
            {chat}
          </aside>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn("flex min-h-0 flex-1 flex-col", className)}
        {...props}
      >
        {player}
        {slimBar}
        <div className="grid grid-cols-2 border-b-2 border-border">
          <TabButton
            active={mobileTab === "chat"}
            onClick={() => setMobileTab("chat")}
          >
            {chatTabLabel}
          </TabButton>
          <TabButton
            active={mobileTab === "info"}
            onClick={() => setMobileTab("info")}
            className="border-l-2 border-border"
          >
            {infoTabLabel}
          </TabButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-card text-card-foreground">
          {mobileTab === "chat" ? chat : context}
        </div>
      </div>
    );
  },
);
WebinarRoomLayout.displayName = "WebinarRoomLayout";

export { WebinarRoomLayout };

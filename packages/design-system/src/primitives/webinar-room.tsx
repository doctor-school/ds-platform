"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Neo-brutalist WEBINAR ROOM layout (006 EARS-2 / EARS-11), reworked to the
 * Twitch-model canvases `design-source/webinar-room-frame.dc.html` +
 * `design-source/chat-column.dc.html` (#1123). It is a VIEWPORT-BOUNDED shell,
 * not a page-flow grid: rendered as the flex body under the room header, it fills
 * the remaining viewport height and clips its own overflow, so the PAGE never
 * scrolls — only the chat ledger does (inside the chat column).
 *
 * - **Desktop** — a flex row: the player region flexes to fill (`flex-1`, dark
 *   letterbox, the embed iframe pinned `inset-0`), a one-line context strip sits
 *   under it, and the chat column is a fixed 340px aside that COLLAPSES to a 44px
 *   rail (a vertical «Чат эфира» label + a red unread badge that accumulates while
 *   folded). Collapsing hides the chat panel but keeps it MOUNTED — the Centrifugo
 *   connection must not tear down on a UI fold.
 * - **Mobile** — a full-bleed 16/9 player, a one-line "what's on air" strip, then a
 *   Чат / О эфире tab strip; the active pane owns the remaining height and the
 *   chat ledger scrolls inside it, composer pinned (the canvas's Вопросы tab is the
 *   wave-2 deferral, design §8.1).
 *
 * Off-scale canvas geometry lives HERE, in the design-system SoT, not in app code:
 * the 340px chat track, the 44px rail, the dark player letterbox and the vertical
 * rail label are computed dimensions the app-scoped `no-arbitrary-tailwind-value`
 * gate forbids in `apps/*` (its SCOPE note exempts the DS component layer). Colour +
 * type flow through tokens → light/dark flips automatically; borders are 2px.
 *
 * The desktop and mobile trees are rendered EXCLUSIVELY (a media-query switch,
 * mirroring the canvas's `isMobile`/`isDesktop`) so the player — and its embed
 * iframe — mounts EXACTLY ONCE per breakpoint (never two concurrent stream frames).
 * It renders the desktop tree during SSR + first paint, then flips on mount; the
 * effect runs after hydration, so there is no hydration mismatch.
 *
 * ALL user-facing copy is injected (EARS-10) — no string is hardcoded here.
 */
export interface WebinarRoomLayoutProps {
  /** The embed player content (badge + iframe / unavailable overlay), pinned
   * `inset-0` inside the region this layout owns — NOT its own aspect box. */
  player: React.ReactNode;
  /** Desktop: the one-line context strip under the player (eyebrow · title · speakers). */
  contextStrip: React.ReactNode;
  /** Mobile: the full event-context block shown in the О эфире tab. */
  context: React.ReactNode;
  /** The chat column body (ledger + composer + connection banners — behaviour is EARS-3). */
  chat: React.ReactNode;
  /** The mobile "what's on air" slim strip shown under the full-bleed player. */
  slimBar?: React.ReactNode;
  /** Mobile Чат tab label (from the catalog). */
  chatTabLabel: string;
  /** Mobile О эфире tab label (from the catalog). */
  infoTabLabel: string;
  /** Chat-column heading («Чат эфира»). */
  chatHeading: string;
  /** Live presence count rendered next to the heading (« · N»); omitted at 0. */
  chatCount?: number;
  /** Rail unread badge count (messages missed while collapsed); shown when > 0. */
  chatUnread?: number;
  /** Accessible label for the unread badge (count-interpolated by the app). */
  chatUnreadLabel?: string;
  /** Accessible label for the desktop collapse control. */
  collapseLabel: string;
  /** Accessible label for the desktop rail expand control. */
  expandLabel: string;
  /** Initial desktop collapse state (uncontrolled; client-only, no persistence). */
  defaultCollapsed?: boolean;
  /** Notified whenever the desktop collapse state flips (the app resets/counts unread). */
  onChatCollapsedChange?: (collapsed: boolean) => void;
}

const LAYOUT_QUERY = "(min-width: 56.3125rem)";

/** Dark player letterbox — permanently dark in BOTH themes (a video mask, not a
 * themed surface), so it is a fixed colour, not a flipping semantic token. */
const PLAYER_BG = "bg-[oklch(0.13_0.018_250)]";

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

/** The chat-column header: heading + live count, plus (desktop) the collapse control. */
function ChatHeader({
  heading,
  count,
  collapseLabel,
  onCollapse,
}: {
  heading: string;
  count?: number | undefined;
  collapseLabel?: string;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex h-11 flex-none items-center justify-between gap-2 border-b-2 border-hairline px-3">
      <span className="text-2xs font-extrabold uppercase tracking-wider text-muted-foreground">
        {heading}
        {count ? (
          <span className="font-bold normal-case tracking-normal">
            {" · "}
            {count}
          </span>
        ) : null}
      </span>
      {onCollapse && collapseLabel ? (
        <button
          type="button"
          onClick={onCollapse}
          aria-label={collapseLabel}
          className="flex h-7 w-7 flex-none items-center justify-center border-2 border-hairline bg-card text-sm font-extrabold text-muted-foreground cursor-pointer hover:border-primary-action hover:text-primary-action focus-visible:outline-none focus-visible:shadow-focus"
        >
          »
        </button>
      ) : null}
    </div>
  );
}

const WebinarRoomLayout = React.forwardRef<
  HTMLDivElement,
  WebinarRoomLayoutProps & React.ComponentPropsWithoutRef<"div">
>(
  (
    {
      player,
      contextStrip,
      context,
      chat,
      slimBar,
      chatTabLabel,
      infoTabLabel,
      chatHeading,
      chatCount,
      chatUnread,
      chatUnreadLabel,
      collapseLabel,
      expandLabel,
      defaultCollapsed = false,
      onChatCollapsedChange,
      className,
      ...props
    },
    ref,
  ) => {
    const isDesktop = useIsDesktop();
    const [mobileTab, setMobileTab] = React.useState<"chat" | "info">("chat");
    const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

    const setCollapsedAnd = (next: boolean) => {
      setCollapsed(next);
      onChatCollapsedChange?.(next);
    };

    if (isDesktop) {
      return (
        <div
          ref={ref}
          className={cn(
            "flex min-h-0 flex-1 overflow-hidden bg-background text-foreground",
            className,
          )}
          {...props}
        >
          {/* Left column: player region (flexes to fill) + one-line context strip. */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className={cn(
                "relative flex min-h-0 flex-1 items-center justify-center",
                PLAYER_BG,
              )}
            >
              {player}
            </div>
            <div className="flex flex-none flex-wrap items-baseline gap-x-3.5 gap-y-1 border-t-2 border-hairline bg-card px-5 py-3">
              {contextStrip}
            </div>
          </div>
          {/* Chat column: 340px aside ⇄ 44px rail. */}
          <aside
            className={cn(
              "flex flex-none flex-col border-l-2 border-border bg-card text-card-foreground",
              collapsed ? "w-11" : "w-[340px]",
            )}
          >
            {collapsed ? (
              <div
                data-testid="room-chat-rail"
                className="flex h-full w-full flex-none flex-col items-center gap-3.5 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => setCollapsedAnd(false)}
                  aria-label={expandLabel}
                  className="flex h-[30px] w-[30px] flex-none items-center justify-center border-2 border-hairline bg-card text-sm font-extrabold text-foreground cursor-pointer hover:border-primary-action hover:text-primary-action focus-visible:outline-none focus-visible:shadow-focus"
                >
                  «
                </button>
                <span className="[writing-mode:vertical-rl] text-2xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  {chatHeading}
                </span>
                {chatUnread ? (
                  <span
                    aria-label={chatUnreadLabel}
                    className="flex h-[18px] min-w-[18px] flex-none items-center justify-center bg-destructive px-1 text-2xs font-extrabold text-destructive-foreground"
                  >
                    {chatUnread}
                  </span>
                ) : null}
              </div>
            ) : null}
            {/* The chat panel stays MOUNTED while collapsed (only hidden) so the
                live connection is not torn down by a UI fold. */}
            <div
              data-testid="room-chat-panel"
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                collapsed && "hidden",
              )}
            >
              <ChatHeader
                heading={chatHeading}
                count={chatCount}
                collapseLabel={collapseLabel}
                onCollapse={() => setCollapsedAnd(true)}
              />
              {chat}
            </div>
          </aside>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground",
          className,
        )}
        {...props}
      >
        <div className={cn("relative aspect-video w-full flex-none", PLAYER_BG)}>
          {player}
        </div>
        {slimBar}
        <div className="grid grid-cols-2 border-b-2 border-border flex-none">
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
          {mobileTab === "chat" ? (
            <>
              <ChatHeader heading={chatHeading} count={chatCount} />
              {chat}
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              {context}
            </div>
          )}
        </div>
      </div>
    );
  },
);
WebinarRoomLayout.displayName = "WebinarRoomLayout";

export { WebinarRoomLayout };

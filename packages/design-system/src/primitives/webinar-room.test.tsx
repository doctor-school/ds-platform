// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WebinarRoomLayout } from "./webinar-room";

// 006 EARS-2 / EARS-11 (#1123) — the Twitch-model room shell. The layout is a
// viewport-bounded flex shell: the player region flexes to fill, the chat column
// is a fixed-width aside that collapses to a 44px rail, and NOTHING here drives a
// page scroll (the ledger owns its own scroll — asserted in the portal chat test).
// `useIsDesktop` reads matchMedia in an effect; jsdom needs it stubbed. SSR/first
// paint default is desktop, so the desktop tree renders without the effect too.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true, // desktop
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderLayout(props?: Partial<Parameters<typeof WebinarRoomLayout>[0]>) {
  return render(
    <WebinarRoomLayout
      player={<div data-testid="the-player">player</div>}
      contextStrip={<div data-testid="the-strip">strip</div>}
      context={<div data-testid="the-context">context</div>}
      chat={<div data-testid="the-chat">chat</div>}
      slimBar={<div data-testid="the-slimbar">slim</div>}
      chatTabLabel="Чат"
      infoTabLabel="О эфире"
      chatHeading="Чат эфира"
      chatCount={214}
      collapseLabel="Свернуть чат"
      expandLabel="Развернуть чат"
      {...props}
    />,
  );
}

describe("006 EARS-11 room shell — viewport-bounded Twitch geometry (#1123)", () => {
  it("EARS-11: the desktop shell is a bounded flex row that never drives a page scroll", () => {
    const { container } = renderLayout();
    const root = container.firstElementChild as HTMLElement;
    // Bounded: fills its parent's height (flex-1 + min-h-0) and clips its own
    // overflow — the page behind it stays fixed.
    expect(root.className).toContain("flex-1");
    expect(root.className).toContain("min-h-0");
    expect(root.className).toContain("overflow-hidden");
  });

  it("EARS-11: the desktop tree renders the player region, the one-line context strip and the chat column", () => {
    renderLayout();
    expect(screen.getByTestId("the-player")).toBeTruthy();
    expect(screen.getByTestId("the-strip")).toBeTruthy();
    expect(screen.getByTestId("the-chat")).toBeTruthy();
    // The heading + live count ride the chat-column header.
    expect(screen.getByText(/Чат эфира/)).toBeTruthy();
    expect(screen.getByText(/214/)).toBeTruthy();
  });

  it("EARS-11: collapsing folds the chat to a rail but keeps the chat node mounted (connection survives)", () => {
    const onChange = vi.fn();
    renderLayout({ onChatCollapsedChange: onChange });
    // Expanded: the collapse control is present, no rail.
    fireEvent.click(screen.getByLabelText("Свернуть чат"));
    expect(onChange).toHaveBeenCalledWith(true);
    // The rail is now shown …
    expect(screen.getByTestId("room-chat-rail")).toBeTruthy();
    expect(screen.getByLabelText("Развернуть чат")).toBeTruthy();
    // … and the chat panel stays in the DOM, only hidden (Centrifugo connection
    // must not tear down on collapse).
    const panel = screen.getByTestId("room-chat-panel");
    expect(panel.className).toContain("hidden");
    expect(screen.getByTestId("the-chat")).toBeTruthy();
  });

  it("EARS-11: a rail unread badge surfaces messages missed while collapsed and expands back", () => {
    const onChange = vi.fn();
    renderLayout({
      defaultCollapsed: true,
      chatUnread: 3,
      chatUnreadLabel: "3 новых сообщения",
      onChatCollapsedChange: onChange,
    });
    expect(screen.getByTestId("room-chat-rail")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Развернуть чат"));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RoomChatCredential, RoomChatMessage } from "@ds/schemas";
import { RoomChat } from "./room-chat";

// 006 EARS-3 — the chat pane's history bootstrap (#843). «Пока нет сообщений»
// (`chatEmpty`) is a STATEMENT about the room, so it must never render while
// the answer is still in flight: after a reload the connect → subscribe →
// history round-trip takes seconds, and flashing the empty-state over an
// active conversation reads as staleness. Until the history read settles the
// pane shows a distinct loading state (DS `Skeleton`); only a SETTLED read
// with zero messages may state the room is empty.

// Passthrough i18n: return the key (tests assert on stable testids / keys, not copy).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("../../../../lib/room-chat-token", () => ({
  fetchFreshChatToken: vi.fn(),
}));

/** Shared handle into the mocked Centrifuge SDK: captured event handlers +
 * a per-test `history` implementation (deferred so tests control settling). */
const sdk = vi.hoisted(() => ({
  handlers: new Map<string, Array<(ctx: unknown) => void>>(),
  history: (() =>
    new Promise(() => {
      // default: never settles — each test overrides
    })) as () => Promise<{ publications: Array<{ data: unknown }> }>,
}));

vi.mock("centrifuge", () => ({
  Centrifuge: class {
    on(event: string, handler: (ctx: unknown) => void): void {
      const list = sdk.handlers.get(event) ?? [];
      list.push(handler);
      sdk.handlers.set(event, list);
    }
    removeListener(event: string, handler: (ctx: unknown) => void): void {
      const list = sdk.handlers.get(event) ?? [];
      sdk.handlers.set(
        event,
        list.filter((h) => h !== handler),
      );
    }
    connect(): void {}
    disconnect(): void {}
    history(): Promise<{ publications: Array<{ data: unknown }> }> {
      return sdk.history();
    }
  },
}));

const chat: RoomChatCredential = {
  url: "wss://rt.example/connection/websocket",
  token: "token",
  channel: "room:evt-1",
  selfTag: "A1",
};

const message: RoomChatMessage = {
  id: "6f9b2f1e-8f1a-4b7e-9c3d-2a1b3c4d5e6f",
  authorTag: "B2",
  text: "Уже в эфире, коллеги!",
  at: "2026-07-13T10:00:00.000Z",
};

function fire(event: string, ctx: unknown): void {
  act(() => {
    for (const handler of sdk.handlers.get(event) ?? []) handler(ctx);
  });
}

beforeEach(() => {
  sdk.handlers.clear();
  sdk.history = () =>
    new Promise(() => {
      // never settles — override per test
    });
});

describe("006 EARS-3 chat history bootstrap — loading is distinct from the empty-state (#843)", () => {
  it("EARS-3: while the history read is in flight, shows the loading skeleton — NEVER chatEmpty", () => {
    render(<RoomChat slug="evt-1" chat={chat} />);
    // In flight from mount (before and after `subscribed`).
    expect(screen.getByTestId("room-chat-loading")).toBeTruthy();
    expect(screen.queryByText("chatEmpty")).toBeNull();
    fire("subscribed", { channel: chat.channel });
    expect(screen.getByTestId("room-chat-loading")).toBeTruthy();
    expect(screen.queryByText("chatEmpty")).toBeNull();
    expect(
      screen.getByTestId("room-chat-messages").getAttribute("aria-busy"),
    ).toBe("true");
  });

  it("EARS-3: chatEmpty renders only after the history read settles with zero messages", async () => {
    let resolveHistory!: (v: { publications: Array<{ data: unknown }> }) => void;
    sdk.history = () =>
      new Promise((res) => {
        resolveHistory = res;
      });
    render(<RoomChat slug="evt-1" chat={chat} />);
    fire("subscribed", { channel: chat.channel });
    expect(screen.queryByText("chatEmpty")).toBeNull();
    act(() => resolveHistory({ publications: [] }));
    await waitFor(() => expect(screen.getByText("chatEmpty")).toBeTruthy());
    expect(screen.queryByTestId("room-chat-loading")).toBeNull();
    expect(
      screen.getByTestId("room-chat-messages").getAttribute("aria-busy"),
    ).toBe("false");
  });

  it("EARS-3: hydrated history replaces the loading state with messages — chatEmpty never appears", async () => {
    let resolveHistory!: (v: { publications: Array<{ data: unknown }> }) => void;
    sdk.history = () =>
      new Promise((res) => {
        resolveHistory = res;
      });
    render(<RoomChat slug="evt-1" chat={chat} />);
    fire("subscribed", { channel: chat.channel });
    act(() => resolveHistory({ publications: [{ data: message }] }));
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    expect(screen.queryByTestId("room-chat-loading")).toBeNull();
    expect(screen.queryByText("chatEmpty")).toBeNull();
  });

  it("EARS-3: a failed history read settles to the empty-state — it does not load forever", async () => {
    let rejectHistory!: (reason: unknown) => void;
    sdk.history = () =>
      new Promise((_res, rej) => {
        rejectHistory = rej;
      });
    render(<RoomChat slug="evt-1" chat={chat} />);
    fire("subscribed", { channel: chat.channel });
    act(() => rejectHistory(new Error("history unavailable")));
    await waitFor(() => expect(screen.getByText("chatEmpty")).toBeTruthy());
    expect(screen.queryByTestId("room-chat-loading")).toBeNull();
  });

  it("EARS-3: a live publication arriving before history settles renders immediately (loading yields to content)", () => {
    render(<RoomChat slug="evt-1" chat={chat} />);
    fire("publication", { channel: chat.channel, data: message });
    expect(screen.getByText(message.text)).toBeTruthy();
    expect(screen.queryByTestId("room-chat-loading")).toBeNull();
    expect(screen.queryByText("chatEmpty")).toBeNull();
  });
});

// 006 EARS-3 — a dead Centrifugo connection must be TRUTHFUL, never silent
// (#1124). A webinar outruns a single connection token TTL and a long-lived
// websocket drops and re-handshakes; the pane tracks the connection state and
// surfaces a reconnecting / disconnected banner rather than leaving an
// established conversation looking live-but-stale — and it NEVER swaps the
// established conversation for the «Пока нет сообщений» empty-state.
describe("006 EARS-3 connection state — a dropped connection is truthful, not silent (#1124)", () => {
  /** Bring the pane to a hydrated, connected, non-empty conversation. */
  function establishConversation(): void {
    let resolveHistory!: (v: { publications: Array<{ data: unknown }> }) => void;
    sdk.history = () =>
      new Promise((res) => {
        resolveHistory = res;
      });
    render(<RoomChat slug="evt-1" chat={chat} />);
    fire("connected", {});
    fire("subscribed", { channel: chat.channel });
    act(() => resolveHistory({ publications: [{ data: message }] }));
  }

  it("EARS-3.1: a dropped connection over an established conversation shows a reconnecting banner — NEVER the empty-state", async () => {
    establishConversation();
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    // The websocket drops → the SDK re-enters the connecting state (backoff retry).
    fire("connecting", {});
    expect(screen.getByTestId("room-chat-reconnecting")).toBeTruthy();
    // The conversation stays on screen; the empty-state never renders over it.
    expect(screen.getByText(message.text)).toBeTruthy();
    expect(screen.queryByText("chatEmpty")).toBeNull();
  });

  it("EARS-3.2: a terminal disconnect (gate no longer admits) surfaces a truthful disconnected banner, not a silent stale pane", async () => {
    establishConversation();
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    // getToken threw UnauthorizedError → the SDK stops permanently (disconnected).
    fire("disconnected", { code: 3500, reason: "unauthorized" });
    expect(screen.getByTestId("room-chat-disconnected")).toBeTruthy();
    expect(screen.queryByText("chatEmpty")).toBeNull();
  });

  it("EARS-3.3: a reconnect clears the reconnecting banner", async () => {
    establishConversation();
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    fire("connecting", {});
    expect(screen.getByTestId("room-chat-reconnecting")).toBeTruthy();
    fire("connected", {});
    expect(screen.queryByTestId("room-chat-reconnecting")).toBeNull();
    expect(screen.getByText(message.text)).toBeTruthy();
  });

  it("EARS-3.4: the reconnecting banner never shows during the FIRST connect — the loading skeleton owns that window", () => {
    render(<RoomChat slug="evt-1" chat={chat} />);
    // Initial connect: connecting + not yet hydrated → skeleton, no reconnect banner.
    fire("connecting", {});
    expect(screen.getByTestId("room-chat-loading")).toBeTruthy();
    expect(screen.queryByTestId("room-chat-reconnecting")).toBeNull();
  });
});

// 006 EARS-3 (#1123) — the Twitch-minimal ledger: a single scroll container that
// pins to the newest message, borderless single-paragraph rows with NO timestamp,
// and a «Новые сообщения ↓» chip when new messages arrive while the reader is
// scrolled up (so the page itself never scrolls and reading history is not
// yanked). While collapsed, arrivals feed the rail unread badge instead.
describe("006 EARS-3 Twitch-minimal ledger — stick-to-bottom + new-messages chip (#1123)", () => {
  const message2: RoomChatMessage = {
    id: "aa11bb22-cc33-44dd-88ee-99ff00112233",
    authorTag: "C3",
    text: "Второе сообщение, коллеги.",
    at: "2026-07-13T10:05:00.000Z",
  };

  /** Hydrate the pane to one message, connected. */
  function seedOneMessage(props?: Partial<Parameters<typeof RoomChat>[0]>): void {
    let resolveHistory!: (v: { publications: Array<{ data: unknown }> }) => void;
    sdk.history = () =>
      new Promise((res) => {
        resolveHistory = res;
      });
    render(<RoomChat slug="evt-1" chat={chat} {...props} />);
    fire("connected", {});
    fire("subscribed", { channel: chat.channel });
    act(() => resolveHistory({ publications: [{ data: message }] }));
  }

  /** jsdom's scrollTop is a no-op — override it so onScroll can read a value. */
  function setScrollTop(el: HTMLElement, value: number): void {
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      writable: true,
      value,
    });
  }

  it("EARS-3: a message row is a single borderless paragraph — name inline with the text, no timestamp column", async () => {
    seedOneMessage();
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    const row = screen.getByTestId("room-chat-message");
    // The whole row (name slot + text) is one element; the text lives directly in it.
    expect(row.textContent).toContain(message.text);
    // The ledger is the reversed scroll container (newest pinned to the bottom).
    expect(
      screen.getByTestId("room-chat-messages").className,
    ).toContain("flex-col-reverse");
  });

  it("EARS-3: while stuck to the bottom, a new message does NOT raise the chip", async () => {
    seedOneMessage();
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    fire("publication", { channel: chat.channel, data: message2 });
    await waitFor(() => expect(screen.getByText(message2.text)).toBeTruthy());
    expect(screen.queryByTestId("room-chat-chip")).toBeNull();
  });

  it("EARS-3: scrolled up, a new message raises the «Новые сообщения ↓» chip, and jumping clears it", async () => {
    seedOneMessage();
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    const ledger = screen.getByTestId("room-chat-messages");
    // Reader scrolls up (|scrollTop| ≥ 32 in the reversed ledger) → autoscroll pauses.
    setScrollTop(ledger, -200);
    fireEvent.scroll(ledger);
    fire("publication", { channel: chat.channel, data: message2 });
    await waitFor(() => expect(screen.getByTestId("room-chat-chip")).toBeTruthy());
    // Jump-to-newest clears the chip.
    fireEvent.click(screen.getByTestId("room-chat-chip"));
    expect(screen.queryByTestId("room-chat-chip")).toBeNull();
  });

  it("EARS-3: while collapsed, a new message feeds the unread callback and never raises the in-ledger chip", async () => {
    const onIncoming = vi.fn();
    seedOneMessage({ collapsed: true, onIncomingWhileCollapsed: onIncoming });
    await waitFor(() => expect(screen.getByText(message.text)).toBeTruthy());
    fire("publication", { channel: chat.channel, data: message2 });
    await waitFor(() => expect(onIncoming).toHaveBeenCalled());
    expect(screen.queryByTestId("room-chat-chip")).toBeNull();
  });
});

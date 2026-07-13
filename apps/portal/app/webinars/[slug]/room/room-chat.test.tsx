// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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

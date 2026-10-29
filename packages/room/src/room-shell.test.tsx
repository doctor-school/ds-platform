import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { RoomChatCredential, RoomConfig } from "@ds/schemas";
import {
  PLAYER_MAX_AUTO_RETRIES,
  PLAYER_RETRY_DELAY_MS,
  ROOM_STATUS_PROBE_WAIT_MS,
} from "./model/room-player-state";
import { RoomShell } from "./room-shell";
import type { RoomContext, RoomCopy, RoomRoutes } from "./types";

/**
 * 006 EARS-11 (#1722) — the shell is the room's ONE viewport-bounded root.
 *
 * The room is a fixed-height application surface, not a document: the page itself
 * must never scroll, and the chat ledger is the single scroll container inside it.
 * That invariant used to live in the Academy's own `page.tsx`; now that both
 * storefronts mount the same composition it belongs to the package, so this suite
 * locks it at the shell level — one `h-dvh` + `overflow-hidden` root, exactly one
 * `overflow-y-auto` element in the whole tree, and that element is the chat ledger.
 */

const sdkHandlers = new Map<string, Array<(ctx: unknown) => void>>();

vi.mock("centrifuge", () => ({
  Centrifuge: class {
    on(event: string, handler: (ctx: unknown) => void): void {
      const list = sdkHandlers.get(event) ?? [];
      list.push(handler);
      sdkHandlers.set(event, list);
    }
    removeListener(event: string, handler: (ctx: unknown) => void): void {
      const list = sdkHandlers.get(event) ?? [];
      sdkHandlers.set(
        event,
        list.filter((h) => h !== handler),
      );
    }
    connect(): void {}
    disconnect(): void {}
    history(): Promise<{ publications: Array<{ data: unknown }> }> {
      return Promise.resolve({ publications: [] });
    }
  },
}));

const routes: RoomRoutes = {
  brandHome: "/webinars",
  eventPage: "/webinars/hsn-therapy",
  accountEvents: "/account/events",
};

const context: RoomContext = {
  school: "Школа нутрициологии",
  title: "Гистамин и питание",
  speakers: "Иван Петров",
};

const chat: RoomChatCredential = {
  url: "wss://rt.example/connection/websocket",
  token: "token",
  channel: "room:evt-1",
  staffChannel: null,
  selfTag: "A1",
};

const config = {
  presenceCount: 3,
  liveAt: null,
  heartbeatIntervalSeconds: 30,
  stream: { provider: "vk", embedRef: "abc123" },
  chat,
} as unknown as RoomConfig;

const copy: RoomCopy = {
  liveBadge: "В эфире",
  brandHome: "К списку эфиров",
  exit: "Выйти",
  themeToggle: "Переключить тему",
  onAir: "Идёт эфир",
  chatTab: "Чат",
  infoTab: "О эфире",
  chatHeading: "Чат эфира",
  chatCollapse: "Свернуть",
  chatExpand: "Развернуть",
  chatUnavailable: "Чат недоступен",
  unavailableTitle: "Трансляция недоступна",
  endedTitle: "Эфир завершён",
  endedBody: "Запись появится в разделе «Мои события»",
  endedBodyLink: "Мои события",
  endedBadge: "Эфир завершён",
  chatEnded: "Эфир завершён — сообщения больше не отправляются",
  unavailableBody: "Восстанавливаем сигнал",
  playerTitle: "Трансляция эфира",
  playerRefresh: "Обновить страницу",
  playerFailedTitle: "Трансляция не загружается",
  playerFailedBody: "Перезапустите плеер",
  playerEmbeddingDisabled: "Встраивание отключено",
  playerUnavailable: "Видео недоступно",
  playerRetrying: "Переподключаемся…",
  playerSuspectedBody: "Похоже, трансляция не загружается.",
  playerRestart: "Перезапустить плеер",
  programNow: "Эфир идёт",
  moderatorPin: "Модератор",
  chatLoading: "Загружаем сообщения",
  chatEmpty: "Пока нет сообщений",
  chatEmptyEnded: "В этом эфире сообщений не было.",
  chatParticipant: "Участник",
  chatYou: "Вы",
  chatNewMessages: "Новые сообщения",
  chatSendError: "Сообщение не отправлено",
  chatReconnecting: "Восстанавливаем связь…",
  chatDisconnected: "Связь потеряна",
  composerPlaceholder: "Написать сообщение",
  composerSend: "Отправить",
  displayNamePrompt: {
    title: "Имя и фамилия",
    description: "Ваше имя будут видеть участники чата эфира",
    label: "Имя и фамилия",
    placeholder: "Иван Иванов",
    submit: "Продолжить",
    error: "Не удалось сохранить имя",
  },
  errors: {
    displayNameRequired: "Укажите имя и фамилию",
    displayNameTooLong: "Имя слишком длинное",
    required: "Заполните поле",
    fallback: "Проверьте значение",
  },
  presenceCount: (count) => `${count} врачей в комнате`,
  liveDuration: (minutes) => ` · ${minutes} мин`,
  avatarLabel: (name) => `Ваш профиль: ${name}`,
  chatUnread: (count) => `${count} новых сообщений`,
};

describe("006 EARS-11 the viewport-bounded room shell", () => {
  beforeEach(() => {
    sdkHandlers.clear();
    // jsdom ships no matchMedia; the DS webinar-room primitive reads it to pick the
    // desktop layout. Report the desktop breakpoint so the chat column mounts.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("006 EARS-11: the room mounts one viewport-bounded root and only the chat ledger scrolls", () => {
    const { container } = render(
      <RoomShell
        slug="hsn-therapy"
        config={config}
        context={context}
        displayName="Иван Петров"
        copy={copy}
        routes={routes}
      />,
    );

    // ONE root, and it is the viewport box: full dynamic viewport height with its
    // own overflow clipped, so the document behind the room never gains a scrollbar.
    const roots = container.querySelectorAll("main");
    expect(roots).toHaveLength(1);
    const root = roots[0] as HTMLElement;
    expect(root.className).toContain("h-dvh");
    expect(root.className).toContain("overflow-hidden");

    // The header bar and the room view both mount inside that single root, under
    // one presence provider — the count the grant seeded reaches the header.
    expect(root.querySelector("header")).not.toBeNull();
    expect(screen.getByText(copy.presenceCount(3))).toBeInTheDocument();
    expect(screen.getByTestId("room-chat")).toBeInTheDocument();

    // Exactly one scroll container in the whole tree, and it is the chat ledger.
    const scrollers = Array.from(
      container.querySelectorAll<HTMLElement>("[class*='overflow-y-auto']"),
    );
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]?.dataset.testid).toBe("room-chat-messages");
    expect(root.className).not.toContain("overflow-y-auto");
  });
});

/**
 * 006 EARS-7 (#1238) — the shell is where the close becomes ONE fact.
 *
 * The leaf suites (`ui/presence-heartbeat.test.tsx`, `ui/room-view.test.tsx`,
 * `ui/room-chat.test.tsx`, `ui/room-header-bar.test.tsx`) each pin their own
 * component with `ended` handed in BY HAND. That leaves the wiring itself — the
 * lifted `ended` state, `onRoomClosed` on {@link PresenceHeartbeat} and the four
 * prop hand-offs — untested: dropping any one of them would keep every leaf test
 * green while the #1238 bug reopens verbatim. This suite drives the REAL chain end
 * to end: a heartbeat refused `409 {state:"ended"}` at the transport, and the whole
 * mounted room asserted afterwards. Unwire any hand-off and a case here goes red.
 */
describe("006 EARS-7 the close reaches every region of the mounted shell", () => {
  beforeEach(() => {
    sdkHandlers.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Answer only the heartbeat with `make()`; every other room call stays 2xx. */
  function stubRoomFetch(make: () => Promise<Response>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === "string" ? input : String((input as { url?: string })?.url ?? "");
        if (url.includes("/heartbeat")) return make();
        return { ok: true, json: async () => ({}) } as unknown as Response;
      }),
    );
  }

  /** A refused beat, exactly as the api answers it. */
  function refusal(status: number, body: unknown): () => Promise<Response> {
    return async () =>
      ({ ok: false, status, json: async () => body }) as unknown as Response;
  }

  function renderShell(): ReturnType<typeof render> {
    return render(
      <RoomShell
        slug="hsn-therapy"
        config={config}
        context={context}
        displayName="Иван Петров"
        copy={copy}
        routes={routes}
      />,
    );
  }

  /** Let the beat's fetch → json → setState chain settle. */
  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
  }

  it("EARS-7.10: a 409 ended beat closes the player, the header pill and the chat in ONE mounted room", async () => {
    stubRoomFetch(refusal(409, { message: "event is not live", state: "ended" }));
    const { container } = renderShell();

    // The heartbeat's refusal is the ONLY input — nothing here sets `ended` by hand.
    await waitFor(() => expect(screen.getByTestId("room-player-ended")).toBeTruthy());

    // Player region: the end card replaced the embed, which is GONE, not hidden.
    const card = screen.getByTestId("room-player-ended");
    expect(card.textContent).toContain(copy.endedTitle);
    expect(container.querySelector("iframe")).toBeNull();
    // The card's «Мои события» leads to the host's own «Мои события» page.
    expect(
      within(card).getByRole("link", { name: copy.endedBodyLink }).getAttribute("href"),
    ).toBe(routes.accountEvents);

    // Header pill: the neutral ended badge, no live wording, no guessed minutes.
    // Scoped to the header — «Эфир завершён» is also the end card's own title.
    const header = within(container.querySelector("header") as HTMLElement);
    expect(header.getByText(copy.endedBadge)).toBeInTheDocument();
    expect(header.queryByText(copy.liveBadge)).toBeNull();
    expect(screen.queryByTestId("room-live-duration")).toBeNull();

    // Chat: the ledger stays, the composer is replaced by the truthful strip.
    expect(screen.getByTestId("room-chat-messages")).toBeInTheDocument();
    expect(screen.getByTestId("room-chat-ended")).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.composerPlaceholder)).toBeNull();
    expect(screen.queryByRole("button", { name: copy.composerSend })).toBeNull();
  });

  it.each([
    [
      "a 409 whose state is still live",
      refusal(409, { message: "conflict", state: "live" }),
    ],
    ["a 401 gate refusal", refusal(401, { message: "unauthorized" })],
    ["a 403 gate refusal", refusal(403, { message: "forbidden" })],
    [
      "a network rejection",
      (() => Promise.reject(new TypeError("Failed to fetch"))) as () => Promise<Response>,
    ],
  ])("EARS-7.10: %s leaves the mounted room live", async (_label, make) => {
    stubRoomFetch(make);
    const { container } = renderShell();

    // Give the beat every chance to land before asserting the room did NOT close.
    await settle();

    const header = within(container.querySelector("header") as HTMLElement);
    expect(screen.queryByTestId("room-player-ended")).toBeNull();
    expect(screen.queryByTestId("room-chat-ended")).toBeNull();
    expect(header.queryByText(copy.endedBadge)).toBeNull();
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(header.getByText(copy.liveBadge)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.composerPlaceholder)).toBeInTheDocument();
  });
});

/**
 * 006 EARS-19 (#2911) — a viewer served `presenceCount: null` (the event's
 * «Показывать зрителям число участников» is off) sees no count anywhere in the
 * room: neither the header «N врачей в комнате» nor the chat heading's « · N».
 */
describe("006 EARS-19 the withheld count is absent from the room", () => {
  beforeEach(() => {
    sdkHandlers.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("006 EARS-19: a null presenceCount renders no header count and no chat-heading count", () => {
    render(
      <RoomShell
        slug="hsn-therapy"
        config={{ ...config, presenceCount: null } as unknown as RoomConfig}
        context={context}
        displayName="Иван Петров"
        copy={copy}
        routes={routes}
      />,
    );
    expect(screen.queryByTestId("room-presence-count")).toBeNull();
    for (const heading of screen.getAllByText(copy.chatHeading, {
      exact: false,
    })) {
      expect(heading.textContent).toBe(copy.chatHeading);
    }
  });
});

/**
 * 006 EARS-7 (#1974) — a close the room has not yet been TOLD about must never read
 * as a broken broadcast. Closing the event stops the stream at once, but the room
 * only learns of the close from its next heartbeat (every `heartbeatIntervalSeconds`,
 * 60 s by default). In between, the player's own failure machine reports the stopped
 * stream as «Трансляция не загружается / Переподключаемся…». So the moment the player
 * reports a failure, the room re-probes its status through the SAME heartbeat call
 * and HOLDS the failure overlay until that probe answers (bounded by
 * `ROOM_STATUS_PROBE_WAIT_MS`): a refusal proving the event left `live` goes
 * straight to the end card — the overlay never renders, not even for one frame.
 */
describe("006 EARS-7 a player failure re-probes the room status", () => {
  const youtubeConfig = {
    ...config,
    stream: { provider: "youtube", embedRef: "dQw4w9WgXcQ" },
  } as unknown as RoomConfig;

  /** How the server answers the NEXT heartbeat. `deferred` parks it until `answer()`. */
  type Answer = "live" | "closed" | "network" | "hang" | "deferred";

  let beats: number;
  let mode: Answer;
  let pending: Array<() => void>;
  /** Every overlay node that was ever attached — catches a single transient frame. */
  let overlaySeen: boolean;
  let observer: MutationObserver;

  const closedResponse = (): Response =>
    ({
      ok: false,
      status: 409,
      json: async () => ({ message: "event is not live", state: "ended" }),
    }) as unknown as Response;
  const liveResponse = (): Response =>
    ({
      ok: true,
      json: async () => ({ eventId: "e", beatAt: new Date().toISOString(), presenceCount: 3 }),
    }) as unknown as Response;

  function answer(): void {
    const queued = pending;
    pending = [];
    for (const resolve of queued) resolve();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sdkHandlers.clear();
    beats = 0;
    mode = "live";
    pending = [];
    overlaySeen = false;
    observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches('[data-testid="room-player-failure"]') ||
            node.querySelector('[data-testid="room-player-failure"]')
          ) {
            overlaySeen = true;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === "string" ? input : String((input as { url?: string })?.url ?? "");
        if (!url.includes("/heartbeat")) {
          return { ok: true, json: async () => ({}) } as unknown as Response;
        }
        beats += 1;
        switch (mode) {
          case "closed":
            return closedResponse();
          case "network":
            throw new TypeError("Failed to fetch");
          case "hang":
            return new Promise<Response>(() => {});
          case "deferred":
            return new Promise<Response>((resolve) => {
              pending.push(() => resolve(closedResponse()));
            });
          default:
            return liveResponse();
        }
      }),
    );
  });

  afterEach(() => {
    observer.disconnect();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
  }

  function fireYouTube(data: string): void {
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { origin: "https://www.youtube.com", data }));
    });
  }

  /** A provider error after the handshake — a CONFIRMED failure (covering overlay). */
  function failPlayer(): void {
    fireYouTube('{"event":"onReady"}');
    fireYouTube('{"event":"onError","info":100}');
  }

  function renderShell(): ReturnType<typeof render> {
    return render(
      <RoomShell
        slug="hsn-therapy"
        config={youtubeConfig}
        context={context}
        displayName="Иван Петров"
        copy={copy}
        routes={routes}
      />,
    );
  }

  it("EARS-7.11: a player failure after an unannounced close shows the end card, not the failure overlay, before the next scheduled beat", async () => {
    renderShell();
    await settle();
    expect(beats).toBe(1); // the entry beat — the room is live.

    // The admin closes the эфир; the stream stops and the provider reports an error.
    mode = "closed";
    failPlayer();
    await settle();

    // No timer advanced: the end card came from the failure-triggered probe, not
    // from the scheduled heartbeat.
    expect(beats).toBe(2);
    expect(screen.getByTestId("room-player-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByText(copy.playerFailedTitle)).toBeNull();
    expect(screen.getByTestId("room-chat-ended")).toBeInTheDocument();
  });

  it("EARS-7.12: while the status probe is in flight the failure overlay is held, and an ended answer goes straight to the end card — the overlay never renders", async () => {
    renderShell();
    await settle();

    mode = "deferred";
    failPlayer();
    await settle();

    // The probe is out, the server has not answered: nothing of the failure UI.
    expect(beats).toBe(2);
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(screen.queryByTestId("room-player-ended")).toBeNull();

    answer();
    await settle();

    expect(screen.getByTestId("room-player-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(overlaySeen).toBe(false);
  });

  it.each([
    ["the probe answers live", "live" as const],
    ["the probe fails on the network", "network" as const],
  ])("EARS-7.12: the failure overlay still appears when %s", async (_label, next) => {
    renderShell();
    await settle();

    mode = next;
    failPlayer();
    await settle();

    expect(beats).toBe(2); // the probe ran.
    expect(screen.queryByTestId("room-player-ended")).toBeNull();
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
  });

  it("EARS-7.12: the failure overlay still appears when the probe exceeds its bounded wait", async () => {
    renderShell();
    await settle();

    mode = "hang";
    failPlayer();
    await settle();
    expect(beats).toBe(2);
    expect(screen.queryByTestId("room-player-failure")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(ROOM_STATUS_PROBE_WAIT_MS);
    });
    await settle();

    expect(screen.queryByTestId("room-player-ended")).toBeNull();
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
  });

  it("EARS-7.11: a tab hidden through the close shows the end card as soon as it is visible again", async () => {
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    renderShell();
    await settle();
    expect(beats).toBe(1);

    act(() => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    mode = "closed";
    // Backgrounded through several grid ticks: nothing is sent.
    act(() => {
      vi.advanceTimersByTime(config.heartbeatIntervalSeconds * 1000 * 3);
    });
    await settle();
    expect(beats).toBe(1);
    expect(screen.queryByTestId("room-player-ended")).toBeNull();

    act(() => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(beats).toBe(2);
    expect(screen.getByTestId("room-player-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
  });

  /** Background the tab (the loop and the hold both hear it). */
  function setHidden(next: boolean, state: { hidden: boolean }): void {
    act(() => {
      state.hidden = next;
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }

  it("EARS-7.12: a player failing while the tab is hidden, then the room closing, never shows the overlay — the visible resume beat goes straight to the end card", async () => {
    const tab = { hidden: false };
    vi.spyOn(document, "hidden", "get").mockImplementation(() => tab.hidden);
    renderShell();
    await settle();

    setHidden(true, tab);
    // The stream fails in the background; nothing can be asked while hidden, so
    // the failure stays HELD — through the bounded wait and the auto-retry steps.
    failPlayer();
    await settle();
    act(() => {
      vi.advanceTimersByTime(PLAYER_RETRY_DELAY_MS * (PLAYER_MAX_AUTO_RETRIES + 2));
    });
    await settle();
    expect(beats).toBe(1);
    expect(screen.queryByTestId("room-player-failure")).toBeNull();

    // The admin closes the эфир while the tab is still away.
    mode = "deferred";
    act(() => {
      vi.advanceTimersByTime(config.heartbeatIntervalSeconds * 1000);
    });
    await settle();
    expect(beats).toBe(1);

    setHidden(false, tab);
    await settle();

    // ONE resume beat serves as the probe; the failure UI waits on its answer.
    expect(beats).toBe(2);
    expect(screen.queryByTestId("room-player-failure")).toBeNull();

    answer();
    await settle();
    expect(screen.getByTestId("room-player-ended")).toBeInTheDocument();
    expect(screen.queryByTestId("room-player-failure")).toBeNull();
    expect(overlaySeen).toBe(false);
  });

  it("EARS-7.12: a player failing while the tab is hidden on a live room shows the overlay once the visible resume beat answers live", async () => {
    const tab = { hidden: false };
    vi.spyOn(document, "hidden", "get").mockImplementation(() => tab.hidden);
    renderShell();
    await settle();

    setHidden(true, tab);
    failPlayer();
    await settle();
    act(() => {
      vi.advanceTimersByTime(ROOM_STATUS_PROBE_WAIT_MS);
    });
    await settle();
    expect(beats).toBe(1);
    expect(overlaySeen).toBe(false);

    mode = "live";
    setHidden(false, tab);
    await settle();

    expect(beats).toBe(2);
    expect(screen.queryByTestId("room-player-ended")).toBeNull();
    expect(screen.getByTestId("room-player-failure")).toBeInTheDocument();
  });
});

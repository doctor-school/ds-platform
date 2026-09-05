import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoomChatCredential, RoomConfig } from "@ds/schemas";
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

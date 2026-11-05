import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_PATH } from "@ds/schemas";

import type { RoomShellProps } from "@ds/room";
import { ROOM_COPY_RU, ROOM_FORMATTERS_RU } from "@ds/room/copy";

/**
 * 006 EARS-11 / EARS-12 / EARS-14 / EARS-15 — the room's `"use client"` wrapper
 * (wave-4 gate rows 23, 25).
 *
 * With no saved name the shared prompt renders INSTEAD of the room; with one,
 * the shared shell composes with the four RU formatters, `next/link` and the
 * shell's own `HeaderUserCluster` in its one chrome slot. The shell itself is
 * asserted in `packages/room/src/room-shell.test.tsx`; here it is a probe that
 * records what the wrapper hands it and paints the cluster.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

// `next/link` becomes a marked anchor, so a client-router link and a plain
// document link (003 EARS-74) are told apart in the DOM.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} data-next-link="" {...rest}>
      {children}
    </a>
  ),
}));

let shellProps: RoomShellProps | null = null;
vi.mock("@ds/room", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/room")>()),
  RoomShell: (props: RoomShellProps) => {
    shellProps = props;
    return <div data-testid="room-shell">{props.userCluster as ReactNode}</div>;
  },
}));

import Link from "next/link";
import { RoomClient, type RoomClientProps } from "./room-client";

const PROPS: Omit<RoomClientProps, "displayName"> = {
  slug: "cardio-live",
  config: {
    eventId: "evt-1",
    heartbeatIntervalSeconds: 30,
    liveAt: null,
    presenceCount: 0,
    stream: null,
    chat: null,
  },
  context: { school: "Школа", title: "Эфир", speakers: "А. Иванов" },
  copy: { ...ROOM_COPY_RU, brandHome: "На страницу эфиров" },
  routes: {
    brandHome: "/webinars",
    eventPage: "/webinars/cardio-live",
    accountEvents: "/account/events",
  },
  guestBounce: "/login?returnTo=%2Fwebinars%2Fcardio-live%2Froom",
};

beforeEach(() => {
  shellProps = null;
  refresh.mockClear();
});

describe("006 EARS-14: no saved name — the JIT prompt renders instead of the room", () => {
  it("006 EARS-14: the «Имя и фамилия» prompt renders and the room does not", () => {
    render(<RoomClient {...PROPS} displayName={null} />);
    const prompt = screen.getByTestId("display-name-prompt");
    expect(prompt).toHaveTextContent("Имя и фамилия");
    expect(prompt).toHaveTextContent(
      ROOM_COPY_RU.displayNamePrompt.description,
    );
    expect(screen.queryByTestId("room-shell")).toBeNull();
    expect(shellProps).toBeNull();
  });
});

describe("006 EARS-11: a saved name — the room composes with the host values", () => {
  it("006 EARS-11: the shell gets the strings plus the four RU formatters, the routes and next/link", () => {
    render(<RoomClient {...PROPS} displayName="Иван Петров" />);
    expect(screen.getByTestId("room-shell")).toBeInTheDocument();
    const props = shellProps as RoomShellProps;
    expect(props.copy).toMatchObject(PROPS.copy);
    expect(props.copy.presenceCount).toBe(ROOM_FORMATTERS_RU.presenceCount);
    expect(props.copy.liveDuration).toBe(ROOM_FORMATTERS_RU.liveDuration);
    expect(props.copy.avatarLabel).toBe(ROOM_FORMATTERS_RU.avatarLabel);
    expect(props.copy.chatUnread).toBe(ROOM_FORMATTERS_RU.chatUnread);
    expect(props.routes).toEqual(PROPS.routes);
    expect(props.linkComponent).toBe(Link);
    expect(props.displayName).toBe("Иван Петров");
    expect(props.slug).toBe("cardio-live");
  });

  it("006 EARS-12 / EARS-15: the chrome slot holds the shell's cluster — the theme toggle and the initials chip linking to /account", () => {
    render(<RoomClient {...PROPS} displayName="Иван Петров" />);
    const chip = screen.getByTestId("room-avatar");
    expect(chip).toHaveAttribute("aria-label", "Ваш профиль: Иван Петров");
    expect(chip).toHaveAttribute("href", "/account");
    expect(chip).toHaveTextContent("ИП");
    expect(chip.className).toContain("hidden");
    expect(chip.className).toContain("layout:inline-flex");
    expect(
      screen.getByRole("button", { name: "Переключить тему" }),
    ).toBeInTheDocument();
  });
});

describe("003 EARS-73 / EARS-74: the room is a signed-in storefront document", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("003 EARS-74: the room's profile chip is a plain document link to /account", () => {
    render(<RoomClient {...PROPS} displayName="Иван Петров" />);
    const chip = screen.getByTestId("room-avatar");
    expect(chip.tagName).toBe("A");
    expect(chip).toHaveAttribute("href", "/account");
    expect(chip).not.toHaveAttribute("data-next-link");
  });

  it("003 EARS-73: the room declares its own guest bounce for the return re-check", () => {
    const { container } = render(
      <RoomClient {...PROPS} displayName="Иван Петров" />,
    );
    expect(container.querySelector("[data-guest-bounce]")).toHaveAttribute(
      "data-guest-bounce",
      PROPS.guestBounce,
    );
  });

  it("003 EARS-73: the room's signed-in cluster mounts the return re-check — one session read per return", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<RoomClient {...PROPS} displayName="Иван Петров" />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(AUTH_SESSION_PATH);
  });
});

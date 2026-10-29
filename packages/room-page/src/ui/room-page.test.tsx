// @vitest-environment node
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME } from "@ds/schemas";
import { ROOM_COPY_RU } from "@ds/room/copy";

import type { RoomPageHostConfig } from "../host-config";
import { RoomClient, type RoomClientProps } from "./room-client";

/**
 * 006 EARS-1 / EARS-2 / EARS-6 / EARS-14 — the live-room route mount (wave-4
 * gate rows 20–22, 24, 25).
 *
 * The page consumes the EARS-1 server grant and renders the room only where it
 * exists: every refusal routes through the host's route table, a missing grant
 * can never fall through to a render, and a granted doctor without a saved name
 * gets the JIT prompt instead of the room. Driven with Academy-shaped values;
 * the reads go through the real `fetchRoomConfig` / `fetchMyDisplayName` over a
 * stubbed `fetch`, so the no-cookie branch is proven to make no api call.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  notFound: () => notFound(),
}));

let incoming = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => incoming,
}));

const fetchPublicEventPage = vi.fn();
vi.mock("@ds/events-storefront/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/server")>()),
  fetchPublicEventPage: (...args: unknown[]) => fetchPublicEventPage(...args),
}));

import { RoomPage } from "./room-page";

const CONFIG: RoomPageHostConfig = {
  routes: {
    room: "/webinars/:slug/room",
    eventPage: "/webinars/:slug",
    brandHome: "/webinars",
    login: "/login",
    accountEvents: "/account/events",
  },
  copy: { brandHome: "На страницу эфиров" },
  eventRead: { pagePath: "/v1/public/events" },
};

const SLUG = "cardio-live";
const GRANT = { roomUrl: "https://example.test/room" };
const EVENT = {
  school: "Школа кардиологии",
  title: "Аритмии",
  speakers: [{ name: "А. Иванов" }, { name: "Б. Петрова" }],
};

const fetchMock = vi.fn();

function respond(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signedIn(): void {
  incoming = new Headers({ cookie: `${SESSION_COOKIE_NAME}=abc` });
}

async function page(): Promise<ReactElement<RoomClientProps>> {
  const tree = await RoomPage({
    config: CONFIG,
    params: Promise.resolve({ slug: SLUG }),
  });
  if (!isValidElement<RoomClientProps>(tree)) {
    throw new Error("the room page rendered no element");
  }
  return tree;
}

beforeEach(() => {
  incoming = new Headers();
  redirect.mockClear();
  notFound.mockClear();
  fetchMock.mockReset();
  fetchPublicEventPage.mockReset().mockResolvedValue(EVENT);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_PROXY_TARGET", "http://api.test/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("006 EARS-6: every refusal routes through the host's route table", () => {
  it("006 EARS-6: a visitor with no session cookie goes to the host login carrying the room return, with no api call", async () => {
    await expect(page()).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Fwebinars%2Fcardio-live%2Froom",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "/login?returnTo=%2Fwebinars%2Fcardio-live%2Froom"],
    [403, "/webinars/cardio-live?from=room"],
    [409, "/webinars/cardio-live"],
  ])(
    "006 EARS-6: a %i refusal redirects to %s and never renders a room",
    async (status, target) => {
      signedIn();
      fetchMock.mockResolvedValueOnce(respond(status));
      await expect(page()).rejects.toThrow(`NEXT_REDIRECT:${target}`);
      expect(fetchPublicEventPage).not.toHaveBeenCalled();
    },
  );

  it("006 EARS-6: an unknown event is a not-found", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(respond(404));
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("006 EARS-2 / EARS-14: a granted doctor gets the room, or the name prompt first", () => {
  it("D4: the grant and display-name reads address serverApiBase() — the env upstream without its trailing slash", async () => {
    signedIn();
    fetchMock
      .mockResolvedValueOnce(respond(200, GRANT))
      .mockResolvedValueOnce(respond(200, { displayName: "Иван Петров" }));
    await page();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://api.test/v1/events/cardio-live/room",
      "http://api.test/v1/me/display-name",
    ]);
    expect(fetchPublicEventPage).toHaveBeenCalledWith(
      SLUG,
      CONFIG.eventRead,
      incoming,
    );
  });

  it("006 EARS-2: a granted doctor with a saved name gets the room with the host's copy, links and event context", async () => {
    signedIn();
    fetchMock
      .mockResolvedValueOnce(respond(200, GRANT))
      .mockResolvedValueOnce(respond(200, { displayName: "Иван Петров" }));
    const tree = await page();
    expect(tree.type).toBe(RoomClient);
    expect(tree.props).toEqual({
      slug: SLUG,
      config: GRANT,
      context: {
        school: "Школа кардиологии",
        title: "Аритмии",
        speakers: "А. Иванов · Б. Петрова",
      },
      copy: { ...ROOM_COPY_RU, brandHome: "На страницу эфиров" },
      routes: {
        brandHome: "/webinars",
        eventPage: "/webinars/cardio-live",
        accountEvents: "/account/events",
      },
      displayName: "Иван Петров",
    });
  });

  it("006 EARS-14: a granted doctor with no saved name gets the prompt branch (displayName null)", async () => {
    signedIn();
    fetchMock
      .mockResolvedValueOnce(respond(200, GRANT))
      .mockResolvedValueOnce(respond(200, { displayName: null }));
    const tree = await page();
    expect(tree.type).toBe(RoomClient);
    expect(tree.props.displayName).toBeNull();
  });

  it("006 EARS-10 (gate row 24): the host's brand-home label is the one copy value it overrides", async () => {
    signedIn();
    fetchMock
      .mockResolvedValueOnce(respond(200, GRANT))
      .mockResolvedValueOnce(respond(200, { displayName: "Иван Петров" }));
    const tree = await RoomPage({
      config: { ...CONFIG, copy: { brandHome: "На главную" } },
      params: Promise.resolve({ slug: SLUG }),
    });
    expect((tree as ReactElement<RoomClientProps>).props.copy.brandHome).toBe(
      "На главную",
    );
  });

  it("004: a granted room whose public event is gone is a not-found", async () => {
    signedIn();
    fetchMock.mockResolvedValueOnce(respond(200, GRANT));
    fetchPublicEventPage.mockResolvedValueOnce(null);
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

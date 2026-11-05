// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { AUTH_SESSION_PATH, guestBounceMarker } from "@ds/schemas";

/**
 * 003 EARS-73 — a returned-to signed-in tab re-checks its session (design
 * amendment 2026-11-05). The island is mounted by the signed-in cluster only;
 * one same-origin `GET /v1/auth/session` per hidden → visible return (or a
 * bfcache `pageshow`), and on a `401` either the in-place guest re-render
 * (`router.refresh()`, an RSC request — never a silent check) or, on a route
 * that declared its guest bounce, that bounce as a document navigation.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { ShellAuthCluster } from "./auth-cluster";
import { SessionRecheck } from "./session-recheck";

let visibility: DocumentVisibilityState = "visible";
const fetchMock = vi.fn();
const assign = vi.fn();

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

function pageshow(persisted: boolean) {
  const event = new Event("pageshow") as PageTransitionEvent;
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

/** Lets the in-flight read settle and its answer be acted on. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function respond(status: number) {
  fetchMock.mockResolvedValue(new Response(null, { status }));
}

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
  respond(200);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  refresh.mockReset();
  assign.mockReset();
});

const DOCTOR = {
  status: "doctor",
  profileHref: "/account",
  label: "Личный кабинет",
} as const;

describe("003 EARS-73: the return re-check", () => {
  it("003 EARS-73: makes no read on the first render nor while the tab is hidden, and exactly one same-origin read per return", async () => {
    render(<SessionRecheck />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("hidden");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      AUTH_SESSION_PATH,
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
    expect(AUTH_SESSION_PATH).toBe("/v1/auth/session");

    // A second return is a second read.
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("003 EARS-73: a repeated `visible` of one return, or a bfcache restore of the same return, makes no second read", async () => {
    render(<SessionRecheck />);
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("visible");
    pageshow(true);
    await flush();
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("003 EARS-73: a bfcache restore (`pageshow` persisted) is one return; a plain `pageshow` is none", async () => {
    render(<SessionRecheck />);
    pageshow(false);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    pageshow(true);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("003 EARS-73: no second read starts while one is in flight", async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    render(<SessionRecheck />);
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(new Response(null, { status: 200 }));
    await flush();
  });

  it("003 EARS-73: a 401 on a route that renders a guest view re-renders it in place with router.refresh(), never a document reload", async () => {
    respond(401);
    render(<SessionRecheck />);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ["/account", "/login?returnTo=%2Faccount"],
    ["/account/events", "/login?returnTo=%2Faccount%2Fevents"],
  ])(
    "003 EARS-73: a 401 on %s takes that route's own declared guest bounce as a document navigation",
    async (_route, bounce) => {
      respond(401);
      render(
        <>
          <span {...guestBounceMarker(bounce)} />
          <SessionRecheck />
        </>,
      );
      setVisibility("hidden");
      setVisibility("visible");
      await flush();
      expect(assign).toHaveBeenCalledWith(bounce);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it.each([[200], [403], [500], [503]])(
    "003 EARS-73: an answer of %s changes nothing",
    async (status) => {
      respond(status);
      render(<SessionRecheck />);
      setVisibility("hidden");
      setVisibility("visible");
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(refresh).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an absolute URL", "https://evil.example/login"],
    ["a protocol-relative URL", "//evil.example/login"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])(
    "003 EARS-73: a 401 under a marker carrying %s never follows it and re-renders in place",
    async (_name, bounce) => {
      respond(401);
      render(
        <>
          <span {...guestBounceMarker(bounce)} />
          <SessionRecheck />
        </>,
      );
      setVisibility("hidden");
      setVisibility("visible");
      await flush();
      expect(assign).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it("003 EARS-73: a transport failure changes nothing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SessionRecheck />);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("003 EARS-73: the signed-in cluster mounts the re-check; a guest render never reads", async () => {
    const view = render(<ShellAuthCluster auth={DOCTOR} />);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount();

    fetchMock.mockClear();
    render(
      <ShellAuthCluster
        auth={{ status: "guest", loginHref: "/login", label: "Войти" }}
      />,
    );
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

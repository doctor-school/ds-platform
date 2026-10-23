import type { Page, Response, Route } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { captureResponse } from "./captured-response.js";

/**
 * Playwright drops a response body once the page navigates away from it
 * («Response body is not available for a response that was navigated away
 * from», #2683). On the sign-in host the form navigates in the same task as the
 * answer (#3172), so the body is kept by a one-shot route that forwards the
 * request and fulfils the page with the very response it fetched.
 */
type Handler = (route: Route) => Promise<void>;

function fakePage(response: Response): {
  page: Page;
  handler: () => Handler | undefined;
  matcher: () => ((url: URL) => boolean) | undefined;
  predicate: () => ((r: Response) => boolean) | undefined;
  times: () => number | undefined;
} {
  let seen: ((r: Response) => boolean) | undefined;
  let routeHandler: Handler | undefined;
  let routeMatcher: ((url: URL) => boolean) | undefined;
  let times: number | undefined;
  const page = {
    route: async (
      match: (url: URL) => boolean,
      h: Handler,
      options?: { times?: number },
    ) => {
      routeMatcher = match;
      routeHandler = h;
      times = options?.times;
    },
    waitForResponse: (match: (r: Response) => boolean) => {
      seen = match;
      return Promise.resolve(response);
    },
  } as unknown as Page;
  return {
    page,
    handler: () => routeHandler,
    matcher: () => routeMatcher,
    predicate: () => seen,
    times: () => times,
  };
}

function fakeResponse(url: string, method: string): Response {
  return {
    url: () => url,
    request: () => ({ method: () => method }),
  } as unknown as Response;
}

function fakeRoute(
  method: string,
  body: string,
  headers: { name: string; value: string }[] = [],
) {
  const calls: string[] = [];
  const fetched = {
    text: async () => body,
    body: async () => Buffer.from(body),
    headersArray: () => headers,
  };
  const route = {
    request: () => ({ method: () => method }),
    fetch: async () => {
      calls.push("fetch");
      return fetched;
    },
    fulfill: async (options: { response: unknown }) => {
      calls.push(options.response === fetched ? "fulfill-same" : "fulfill");
    },
  } as unknown as Route;
  return { route, calls };
}

describe("captureResponse", () => {
  it("keeps the body the route fetched and fulfils the page with that response", async () => {
    const response = fakeResponse(
      "https://login.example/v1/sign-in-host/login",
      "POST",
    );
    const fake = fakePage(response);
    const pending = captureResponse(fake.page, "/v1/sign-in-host/login");
    await Promise.resolve();
    const { route, calls } = fakeRoute(
      "POST",
      '{"status":"redirect","url":"https://idp.example/cb"}',
    );
    await fake.handler()!(route);
    const captured = await pending;
    expect(captured.response.url()).toBe(response.url());
    expect(captured.body).toBe(
      '{"status":"redirect","url":"https://idp.example/cb"}',
    );
    expect(calls).toEqual(["fetch", "fulfill-same"]);
    expect(fake.times()).toBe(1);
  });

  it("matches only a POST to the exact pathname", async () => {
    const fake = fakePage(
      fakeResponse("https://academy.example/v1/auth/login", "POST"),
    );
    void captureResponse(fake.page, "/v1/auth/login/otp");
    await Promise.resolve();
    const match = fake.predicate()!;
    expect(
      match(fakeResponse("https://a.example/v1/auth/login/otp", "POST")),
    ).toBe(true);
    expect(
      match(fakeResponse("https://a.example/v1/auth/login/otp", "GET")),
    ).toBe(false);
    expect(match(fakeResponse("https://a.example/v1/auth/login", "POST"))).toBe(
      false,
    );
    const routeMatch = fake.matcher()!;
    expect(routeMatch(new URL("https://a.example/v1/auth/login/otp"))).toBe(
      true,
    );
    expect(routeMatch(new URL("https://a.example/v1/auth/login"))).toBe(false);
  });

  it("a second capture of the same pending POST shares the first one", async () => {
    const response = fakeResponse(
      "https://login.example/v1/sign-in-host/register",
      "POST",
    );
    const fake = fakePage(response);
    let routes = 0;
    const route = fake.page.route.bind(fake.page);
    (fake.page as unknown as { route: typeof route }).route = (...args) => {
      routes += 1;
      return route(...args);
    };
    const outer = captureResponse(fake.page, "/v1/sign-in-host/register");
    const inner = captureResponse(fake.page, "/v1/sign-in-host/register");
    expect(routes, "one route serves both captures").toBe(1);
    await Promise.resolve();
    const { route: r } = fakeRoute("POST", '{"status":"pending_verification"}');
    await fake.handler()!(r);
    expect((await outer).body).toBe('{"status":"pending_verification"}');
    expect(await inner).toBe(await outer);
    // Settled: the next capture of that pathname is a new one.
    void captureResponse(fake.page, "/v1/sign-in-host/register");
    expect(routes).toBe(2);
  });

  it("answers header reads from the fulfilled response, Set-Cookie included", async () => {
    // A page-observed response that was fulfilled reports no Set-Cookie.
    const response = {
      ...fakeResponse("https://academy.example/v1/auth/logout", "POST"),
      headerValue: async () => null,
      status: () => 200,
    } as unknown as Response;
    const fake = fakePage(response);
    const pending = captureResponse(fake.page, "/v1/auth/logout");
    await Promise.resolve();
    const { route } = fakeRoute("POST", '{"status":"logged_out"}', [
      { name: "Set-Cookie", value: "__Host-ds_session=; Max-Age=0" },
      { name: "set-cookie", value: "other=; Max-Age=0" },
      { name: "content-type", value: "application/json" },
    ]);
    await fake.handler()!(route);
    const captured = await pending;
    expect(await captured.response.headerValue("set-cookie")).toBe(
      "__Host-ds_session=; Max-Age=0\nother=; Max-Age=0",
    );
    expect(await captured.response.headerValue("x-absent")).toBeNull();
    expect(await captured.response.headerValues("set-cookie")).toHaveLength(2);
    expect(captured.response.status()).toBe(200);
  });
});

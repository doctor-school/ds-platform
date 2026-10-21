import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
} from "./forwarded-session.js";

const SESSION = {
  cookie: "__Host-ds_session=abc",
  userAgent: "Mozilla/5.0 (probe)",
  acceptLanguage: "ru-RU,ru;q=0.9",
  forwardedFor: "203.0.113.7, 172.18.0.4",
};

describe("forwarded-session surface (#2073 D5)", () => {
  it("SESSION_COOKIE_NAME is the origin-locked BFF cookie", () => {
    expect(SESSION_COOKIE_NAME).toBe("__Host-ds_session");
  });

  it("hasSessionCookie is name-boundary aware", () => {
    expect(hasSessionCookie(`${SESSION_COOKIE_NAME}=abc`)).toBe(true);
    expect(hasSessionCookie(`other=1; ${SESSION_COOKIE_NAME}=abc`)).toBe(true);
    expect(hasSessionCookie(`x${SESSION_COOKIE_NAME}=abc`)).toBe(false);
    expect(hasSessionCookie(`decoy=${SESSION_COOKIE_NAME}=abc`)).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });
});

/**
 * #2054 — the api resolves `request.ip` from the client chain (#1655
 * trustProxy) and binds the session fingerprint to the browser's IP/24. An SSR
 * hop that relays cookie + user-agent + accept-language but drops the forwarded
 * chain therefore re-derives a different fingerprint and 401s a valid session.
 */
describe("#2054 forwarded client address on the SSR hop", () => {
  it("2054.1: forwardedSessionFrom carries the incoming x-forwarded-for verbatim", () => {
    expect(
      forwardedSessionFrom(
        new Headers({
          cookie: "__Host-ds_session=abc",
          "user-agent": "Mozilla/5.0 (probe)",
          "accept-language": "ru-RU",
          "x-forwarded-for": "203.0.113.7, 172.18.0.4",
        }),
      ),
    ).toEqual({
      cookie: "__Host-ds_session=abc",
      userAgent: "Mozilla/5.0 (probe)",
      acceptLanguage: "ru-RU",
      forwardedFor: "203.0.113.7, 172.18.0.4",
    });
  });

  it("2054.2: a request with no session cookie yields an empty cookie and issues no authed headers", () => {
    const anonymous = forwardedSessionFrom(
      new Headers({ cookie: "other=1", "x-forwarded-for": "203.0.113.7" }),
    );
    expect(anonymous.cookie).toBe("");
    // The public reads still fire; they carry no session surface, but they DO
    // carry the client chain (request.ip also keys the api's rate-limit windows).
    expect(forwardedHeaders(anonymous)).toEqual({
      accept: "application/json",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("2054.3: forwardedHeaders omits x-forwarded-for entirely when the incoming request carried none", () => {
    const sent = forwardedHeaders({ ...SESSION, forwardedFor: "" });
    expect("x-forwarded-for" in sent).toBe(false);
    // Local dev has no proxy: without the header the api falls back to the socket
    // peer, which IS the same loopback the browser's login rode through.
    expect(sent.cookie).toBe(SESSION.cookie);
  });

  it("D5: an authenticated session sends the full fingerprint surface", () => {
    expect(forwardedHeaders(SESSION)).toEqual({
      accept: "application/json",
      cookie: SESSION.cookie,
      "user-agent": SESSION.userAgent,
      "accept-language": SESSION.acceptLanguage,
      "x-forwarded-for": SESSION.forwardedFor,
    });
  });
});

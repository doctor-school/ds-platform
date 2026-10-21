/**
 * hotfix #2054 — the public event-page read must relay the client chain
 * (`x-forwarded-for`) like every other SSR hop: `request.ip` keys the api's
 * rate-limit windows (#1655 EARS-13), and a read that hides the client behind
 * the container address pools every visitor into one bucket. The read is
 * deliberately session-free (020 EARS-1): ONLY the host's relay cookie
 * (`contentSet.relayCookie` — 017's remembered specialty on the doctor host,
 * wave-3 gate D4) travels, never the session cookie or its fingerprint surface.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicEventPage } from "./public-events";
import { SESSION_COOKIE_NAME } from "@ds/schemas";

const RELAY_COOKIE = "__Host-ds_specialty";
const DOCTOR_READ = {
  pagePath: "/v1/storefront/doctor/events",
  relayCookie: RELAY_COOKIE,
};

function okPage() {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "e1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sentHeaders = (fetchMock: ReturnType<typeof okPage>) =>
  fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#2054 doctor event-page read forwards the client chain", () => {
  it("2054.1: relays x-forwarded-for and ONLY the specialty cookie — no session, no fingerprint surface", async () => {
    const fetchMock = okPage();
    await fetchPublicEventPage(
      "prp-gonartroz",
      DOCTOR_READ,
      new Headers({
        cookie: `${SESSION_COOKIE_NAME}=abc; ${RELAY_COOKIE}=cardiology`,
        "user-agent": "Mozilla/5.0 (probe)",
        "accept-language": "ru-RU",
        "x-forwarded-for": "203.0.113.7, 172.18.0.5",
      }),
    );
    expect(sentHeaders(fetchMock)).toEqual({
      accept: "application/json",
      cookie: `${RELAY_COOKIE}=cardiology`,
      "x-forwarded-for": "203.0.113.7, 172.18.0.5",
    });
  });

  it("2054.2: omits x-forwarded-for when the incoming request carried none (local dev, no proxy)", async () => {
    const fetchMock = okPage();
    await fetchPublicEventPage("prp-gonartroz", DOCTOR_READ, new Headers());
    expect(sentHeaders(fetchMock)).toEqual({ accept: "application/json" });
  });
});

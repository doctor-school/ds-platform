/**
 * hotfix #2054 — the public event-page read of the doctor storefront must relay
 * the client chain (`x-forwarded-for`) like every other SSR hop: `request.ip`
 * keys the api's rate-limit windows (#1655 EARS-13), and a read that hides the
 * client behind the container address pools every visitor into one bucket. The
 * read is deliberately session-free (020 EARS-1): ONLY 017's remembered-specialty
 * cookie travels, never the session cookie or its fingerprint surface.
 */
import { describe, it, expect, vi } from "vitest";

import { fetchDoctorEventPage } from "./event-page";
import { SESSION_COOKIE_NAME } from "./session";
import { SPECIALTY_CHOICE_COOKIE_NAME } from "./specialty-choice";

const okPage = () =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "e1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

const sentHeaders = (fetchImpl: ReturnType<typeof okPage>) =>
  (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<
    string,
    string
  >;

describe("#2054 doctor event-page read forwards the client chain", () => {
  it("2054.1: relays x-forwarded-for and ONLY the specialty cookie — no session, no fingerprint surface", async () => {
    const fetchImpl = okPage();
    await fetchDoctorEventPage(
      "prp-gonartroz",
      new Headers({
        cookie: `${SESSION_COOKIE_NAME}=abc; ${SPECIALTY_CHOICE_COOKIE_NAME}=cardiology`,
        "user-agent": "Mozilla/5.0 (probe)",
        "accept-language": "ru-RU",
        "x-forwarded-for": "203.0.113.7, 172.18.0.5",
      }),
      fetchImpl,
    );
    expect(sentHeaders(fetchImpl)).toEqual({
      accept: "application/json",
      cookie: `${SPECIALTY_CHOICE_COOKIE_NAME}=cardiology`,
      "x-forwarded-for": "203.0.113.7, 172.18.0.5",
    });
  });

  it("2054.2: omits x-forwarded-for when the incoming request carried none (local dev, no proxy)", async () => {
    const fetchImpl = okPage();
    await fetchDoctorEventPage("prp-gonartroz", new Headers(), fetchImpl);
    expect(sentHeaders(fetchImpl)).toEqual({
      accept: "application/json",
      cookie: "",
    });
  });
});

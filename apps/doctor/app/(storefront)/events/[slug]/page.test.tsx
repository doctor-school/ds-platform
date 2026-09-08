import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPageView, ParticipationCta } from "@ds/schemas";

const {
  fetchDoctorEventPage,
  fetchDoctorParticipationCta,
  fetchEventRegistrationState,
  headers,
  notFound,
} = vi.hoisted(() => ({
  fetchDoctorEventPage: vi.fn(),
  fetchDoctorParticipationCta: vi.fn(),
  fetchEventRegistrationState: vi.fn(),
  headers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/event-page", () => ({
  fetchDoctorEventPage,
  fetchDoctorParticipationCta,
}));
vi.mock("@ds/events-storefront/server", () => ({ fetchEventRegistrationState }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({
  notFound,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import DoctorEventPage from "./page";

const EVENT: EventPageView = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "prp-gonartroz",
  title: "PRP при гонартрозе",
  school: "Школа ортобиологии",
  startsAt: "2026-08-28T16:00:00.000Z",
  durationMin: 90,
  nmo: false,
  pulCost: 0,
  description: "Разбор клинического случая.",
  speakers: [],
  specialties: ["Травматология и ортопедия"],
  partners: [],
  state: "published",
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
  },
  format: "online",
  seatsLeft: null,
  links: { speakerPages: [] },
};

/** What the api resolves for a viewer who is not registered yet — guest or not. */
const REGISTER_CTA: ParticipationCta = {
  action: "register",
  label: "Участвовать",
  href: "/register?returnTo=%2Fevents%2Fprp-gonartroz",
  reason: null,
  presenceCount: null,
};

const REGISTERED_CTA: ParticipationCta = {
  action: "registered",
  label: "Вы записаны",
  href: null,
  reason: null,
  presenceCount: null,
};

/** A signed-in viewer: the doctor host forwards a `__Host-` session cookie. */
const SIGNED_IN = new Headers({
  cookie: "__Host-ds_session=abc",
  "user-agent": "vitest",
  "accept-language": "ru-RU",
});
const GUEST = new Headers({ "user-agent": "vitest", "accept-language": "ru-RU" });

const render = async () =>
  renderToStaticMarkup(
    await DoctorEventPage({ params: Promise.resolve({ slug: "prp-gonartroz" }) }),
  );

/**
 * 005 EARS-1 / 020 EARS-1 (#2005) — one-tap registration on `doctor.school`.
 *
 * The mechanism is the ACADEMY's, extracted into `@ds/events-storefront`: the
 * card's control slot carries the shared `RegisterOneTap`, the same command and
 * the same progressive-enhancement form. What this route owns, and therefore what
 * is asserted here, is the PROJECTION: which viewer gets the control, which gets
 * the server-resolved `/register` link, and the host copy for a failed tap.
 */
describe("005 EARS-1 #2005: one-tap registration on the doctor event page", () => {
  beforeEach(() => {
    fetchDoctorEventPage.mockReset().mockResolvedValue(EVENT);
    fetchDoctorParticipationCta.mockReset().mockResolvedValue(REGISTER_CTA);
    fetchEventRegistrationState.mockReset().mockResolvedValue(null);
    headers.mockReset().mockResolvedValue(SIGNED_IN);
    notFound.mockClear();
  });

  it("020 EARS-1 / 005 EARS-1: a signed-in unregistered doctor gets the one-tap control inside the signup card, not the /register link", async () => {
    // Not registered yet, but the session read answers ⇒ authenticated.
    fetchEventRegistrationState.mockResolvedValue({ registered: false });

    const html = await render();

    expect(fetchEventRegistrationState).toHaveBeenCalledWith(
      "prp-gonartroz",
      expect.objectContaining({
        cookie: "__Host-ds_session=abc",
        userAgent: "vitest",
        acceptLanguage: "ru-RU",
      }),
    );
    expect(html).toContain('data-testid="event-register-one-tap"');
    // The tap fires the command in place; the guest hand-off is not offered to
    // someone who already has a session.
    expect(html).not.toContain("/register?returnTo=");
  });

  it("020 EARS-5: a guest gets the /register?returnTo=/events/<slug> link and no one-tap control", async () => {
    headers.mockResolvedValue(GUEST);

    const html = await render();

    // No session cookie ⇒ no upstream read on nobody's behalf, and the card
    // renders the target the api resolved against THIS host's route table.
    expect(fetchEventRegistrationState).not.toHaveBeenCalled();
    expect(html).toContain("/register?returnTo=%2Fevents%2Fprp-gonartroz");
    expect(html).not.toContain('data-testid="event-register-one-tap"');
  });

  it("005 EARS-4: a registered doctor gets the «Вы записаны» card and no control", async () => {
    fetchDoctorParticipationCta.mockResolvedValue(REGISTERED_CTA);
    fetchEventRegistrationState.mockResolvedValue({ registered: true });

    const html = await render();

    expect(html).toContain("Вы записаны");
    expect(html).not.toContain('data-testid="event-register-one-tap"');
  });
});

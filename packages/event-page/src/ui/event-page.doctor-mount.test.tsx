import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EventPageView,
  EventPlayback,
  ParticipationCta,
} from "@ds/schemas";

import type { EventPageHostConfig } from "../host-config";

const {
  fetchPublicEventPage,
  fetchParticipationCta,
  fetchEventRegistrationState,
  fetchEventPlayback,
  headers,
  notFound,
} = vi.hoisted(() => ({
  fetchPublicEventPage: vi.fn(),
  fetchParticipationCta: vi.fn(),
  fetchEventRegistrationState: vi.fn(),
  fetchEventPlayback: vi.fn(),
  headers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// Only the READS are stubbed: `forwardedSessionFrom` (`@ds/schemas`) is the real shared builder
// the page derives the forwarded surface with, so a mock that replaced the whole
// module would hide a broken build of that surface (#2054).
vi.mock("@ds/events-storefront/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/server")>()),
  fetchPublicEventPage,
  fetchParticipationCta,
  fetchEventRegistrationState,
}));
vi.mock("../server/event-playback", () => ({ fetchEventPlayback }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({
  notFound,
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { EventPage } = await import("./event-page");

/**
 * The doctor storefront's values, as `DOCTOR_EVENT_PAGE` of
 * `apps/doctor/lib/events-storefront.host-config.ts` declares them (gate §4.4).
 * The package cannot import an app module, so they are restated here.
 */
const DOCTOR = {
  contentSet: {
    pagePath: "/v1/storefront/doctor/events",
    relayCookie: "__Host-ds_specialty",
  },
  routes: {
    listing: "/events",
    eventPage: "/events",
    login: "/login",
    register: "/register",
  },
  copy: { breadcrumb: "События" },
} satisfies EventPageHostConfig;

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
    durationSec: null,
  },
  format: "online",
  seatsLeft: null,
  signUps: null,
  viewers: null,
  links: { speakerPages: [] },
};

const ENDED_PUBLISHED: EventPageView = {
  ...EVENT,
  state: "ended",
  recording: {
    state: "montage",
    primaryKind: "edited",
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
    durationSec: 5400,
  },
};

const ENDED_PREPARING: EventPageView = { ...EVENT, state: "ended" };

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

const UNAVAILABLE_CTA: ParticipationCta = {
  action: "unavailable",
  label: "Участие недоступно",
  href: null,
  reason: null,
  presenceCount: null,
};

const PLAYBACK: EventPlayback = {
  primary: {
    kind: "edited",
    provider: "rutube",
    embedRef: "0123456789abcdef0123456789abcdef",
    posterRef: null,
    durationSec: 5400,
  },
  secondary: null,
};

/** A signed-in viewer: the doctor host forwards a `__Host-` session cookie. */
const SIGNED_IN = new Headers({
  cookie: "__Host-ds_session=abc",
  "user-agent": "vitest",
  "accept-language": "ru-RU",
});
const GUEST = new Headers({
  "user-agent": "vitest",
  "accept-language": "ru-RU",
});

const render = async (from?: string) =>
  renderToStaticMarkup(
    await EventPage({
      config: DOCTOR,
      params: Promise.resolve({ slug: "prp-gonartroz" }),
      searchParams: Promise.resolve(from ? { from } : {}),
    }),
  );

beforeEach(() => {
  fetchPublicEventPage.mockReset().mockResolvedValue(EVENT);
  fetchParticipationCta.mockReset().mockResolvedValue(REGISTER_CTA);
  fetchEventRegistrationState.mockReset().mockResolvedValue(null);
  fetchEventPlayback.mockReset().mockResolvedValue(PLAYBACK);
  headers.mockReset().mockResolvedValue(SIGNED_IN);
  notFound.mockClear();
});

/**
 * 005 EARS-1 / 020 EARS-1 (#2005) — one-tap registration on `doctor.school`.
 *
 * The mechanism is the ACADEMY's, in `@ds/events-storefront`: the card's control
 * slot carries the shared `RegisterOneTap`. What is asserted here is the
 * PROJECTION on the doctor's config: which viewer gets the control, which gets
 * the server-resolved `/register` link.
 */
describe("005 EARS-1 #2005: one-tap registration on the doctor event page", () => {
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

    // The card renders the target the api resolved against THIS host's route
    // table; the reads sit at the doctor's pagePath with its relay cookie.
    expect(fetchPublicEventPage).toHaveBeenCalledWith(
      "prp-gonartroz",
      DOCTOR.contentSet,
      GUEST,
    );
    expect(fetchParticipationCta).toHaveBeenCalledWith(
      "prp-gonartroz",
      expect.objectContaining({ cookie: "" }),
      "/v1/storefront/doctor/events",
    );
    expect(html).toContain("/register?returnTo=%2Fevents%2Fprp-gonartroz");
    expect(html).not.toContain('data-testid="event-register-one-tap"');
  });

  it("020 EARS-5: a signed-in unregistered doctor reads the event's Pul cost under «Участвовать», never the guest return note (#3307)", async () => {
    fetchPublicEventPage.mockResolvedValue({ ...EVENT, pulCost: 50 });
    fetchEventRegistrationState.mockResolvedValue({ registered: false });

    const html = await render();

    expect(html).toContain("Спишем 50 Pul при записи.");
    expect(html).not.toContain("вернём вас на эту страницу");
  });

  it("020 EARS-5: a guest keeps the return note under «Участвовать» (#3307)", async () => {
    headers.mockResolvedValue(GUEST);
    fetchPublicEventPage.mockResolvedValue({ ...EVENT, pulCost: 50 });

    const html = await render();

    expect(html).toContain("Нужна регистрация — вернём вас на эту страницу.");
    expect(html).not.toContain("Спишем");
  });

  it("005 EARS-4: a registered doctor gets the «Вы записаны» card and no control", async () => {
    fetchParticipationCta.mockResolvedValue(REGISTERED_CTA);
    fetchEventRegistrationState.mockResolvedValue({ registered: true });

    const html = await render();

    expect(html).toContain("Вы записаны");
    expect(html).not.toContain('data-testid="event-register-one-tap"');
  });
});

/**
 * Wave-3 gate §2.2 rows 22–25 — the convergences the doctor host gains by
 * mounting the ONE page (020 EARS-10 / EARS-18): before PR 3.2 the doctor page
 * rendered the lifecycle plate only, no player card, no gate and no strip.
 */
describe("020 EARS-10 / EARS-18: the ended-event recording and the room strip on the doctor mount", () => {
  it("EARS-10: an ended event with a published recording shows the recording badge on the doctor mount", async () => {
    fetchPublicEventPage.mockResolvedValue(ENDED_PUBLISHED);
    fetchParticipationCta.mockResolvedValue(UNAVAILABLE_CTA);
    headers.mockResolvedValue(GUEST);

    const html = await render();

    expect(html).toContain('data-testid="recording-badge"');
    expect(html).toContain("Запись доступна");
    // Beside the lifecycle plate, not instead of it.
    expect(html).toContain("Эфир завершён");
  });

  it("EARS-10: the doctor mount renders the plaque, the guest gate and the signed-in player from the same projection", async () => {
    fetchParticipationCta.mockResolvedValue(UNAVAILABLE_CTA);

    // Nothing published yet — the plaque, for a guest as for a doctor.
    fetchPublicEventPage.mockResolvedValue(ENDED_PREPARING);
    headers.mockResolvedValue(GUEST);
    const plaque = await render();
    expect(plaque).toContain('data-testid="recording-plaque"');
    expect(plaque).not.toContain('data-testid="recording-gate"');

    // Published, guest — the gate; the source read is never issued.
    fetchPublicEventPage.mockResolvedValue(ENDED_PUBLISHED);
    const gate = await render();
    expect(gate).toContain('data-testid="recording-gate"');
    expect(gate).not.toContain('data-testid="recording-player-rutube"');
    expect(fetchEventPlayback).not.toHaveBeenCalled();

    // Published, signed in — the player from the authenticated source read.
    headers.mockResolvedValue(SIGNED_IN);
    fetchEventRegistrationState.mockResolvedValue({ registered: true });
    const player = await render();
    expect(fetchEventPlayback).toHaveBeenCalledWith(
      "prp-gonartroz",
      expect.objectContaining({ cookie: "__Host-ds_session=abc" }),
    );
    expect(player).toContain('data-testid="recording-player-rutube"');
    expect(player).not.toContain('data-testid="recording-gate"');
    expect(player).not.toContain('data-testid="recording-spoiler"');

    // A second published cut — the raw-original spoiler.
    fetchEventPlayback.mockResolvedValue({
      ...PLAYBACK,
      secondary: { ...PLAYBACK.primary!, kind: "raw" },
    });
    const spoiler = await render();
    expect(spoiler).toContain('data-testid="recording-spoiler"');
  });

  it("EARS-10: the doctor gate's hrefs carry /events/<slug> to the doctor door", async () => {
    fetchPublicEventPage.mockResolvedValue(ENDED_PUBLISHED);
    fetchParticipationCta.mockResolvedValue(UNAVAILABLE_CTA);
    headers.mockResolvedValue(GUEST);

    const html = await render();

    const hrefOf = (testId: string) =>
      html.match(
        new RegExp(`<a data-testid="${testId}"[^>]* href="([^"]*)"`),
      )?.[1];
    expect(hrefOf("recording-gate-signin")).toBe(
      "/login?returnTo=%2Fevents%2Fprp-gonartroz",
    );
    expect(hrefOf("recording-gate-signup")).toBe(
      "/register?returnTo=%2Fevents%2Fprp-gonartroz",
    );
  });

  it("EARS-18: a signed-in unregistered doctor arriving with ?from=room sees the guidance on both hosts", async () => {
    fetchEventRegistrationState.mockResolvedValue({ registered: false });

    const fromRoom = await render("room");
    expect(fromRoom).toContain('data-testid="room-access-guidance"');
    expect(fromRoom).toContain("Чтобы войти в эфир, сначала зарегистрируйтесь");

    // Not from the room — no strip.
    expect(await render()).not.toContain('data-testid="room-access-guidance"');
  });
});

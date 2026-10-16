import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPageView, ParticipationCta } from "@ds/schemas";

import type { EventPageHostConfig } from "../host-config";

const {
  fetchPublicEventPage,
  fetchParticipationCta,
  fetchEventRegistrationState,
  fetchEventPlayback,
  headers,
  refresh,
  viewerZone,
} = vi.hoisted(() => ({
  fetchPublicEventPage: vi.fn(),
  fetchParticipationCta: vi.fn(),
  fetchEventRegistrationState: vi.fn(),
  fetchEventPlayback: vi.fn(),
  headers: vi.fn(),
  refresh: vi.fn(),
  viewerZone: { current: "Europe/Moscow" },
}));

vi.mock("@ds/events-storefront/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/server")>()),
  fetchPublicEventPage,
  fetchParticipationCta,
  fetchEventRegistrationState,
}));
vi.mock("@ds/events-storefront/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/ui")>()),
  useViewerZone: () => viewerZone.current,
}));
vi.mock("../server/event-playback", () => ({ fetchEventPlayback }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh }),
}));

const { EventPage } = await import("./event-page");
const { EventPageError } = await import("./event-page-error");
const { EventPageSkeleton } = await import("./event-page-skeleton");
const { ViewerZoneTime } = await import("./viewer-zone-time");

/** The two hosts' values, restated (a package cannot import an app module). */
const HOSTS = {
  academy: {
    contentSet: { pagePath: "/v1/public/events" },
    routes: {
      listing: "/webinars",
      eventPage: "/webinars",
      login: "/login",
      register: "/register",
    },
    copy: { breadcrumb: "Эфиры" },
  },
  doctor: {
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
  },
} satisfies Record<string, EventPageHostConfig>;

const ENDED: EventPageView = {
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
  specialties: [],
  partners: [
    { label: "Партнёр А" },
    { label: "Партнёр Б" },
  ] as EventPageView["partners"],
  state: "ended",
  recording: {
    state: "montage",
    primaryKind: "edited",
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
    durationSec: 5400,
  },
  format: "online",
  seatsLeft: null,
  links: { speakerPages: [] },
};

const UNAVAILABLE: ParticipationCta = {
  action: "unavailable",
  label: "Участие недоступно",
  href: null,
  reason: null,
  presenceCount: null,
};

const GUEST = new Headers({ "user-agent": "vitest" });

const renderPage = async (config: EventPageHostConfig) =>
  renderToStaticMarkup(
    await EventPage({
      config,
      params: Promise.resolve({ slug: ENDED.slug }),
      searchParams: Promise.resolve({}),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  viewerZone.current = "Europe/Moscow";
  document.body.replaceChildren();
  fetchPublicEventPage.mockResolvedValue(ENDED);
  fetchParticipationCta.mockResolvedValue(UNAVAILABLE);
  fetchEventRegistrationState.mockResolvedValue(null);
  headers.mockResolvedValue(GUEST);
});

describe.each(Object.entries(HOSTS))(
  "wave-3 PR 3.2 convergences on the %s mount",
  (_host, config) => {
    it("020 EARS-19 (gate row 26, D5): the partners plate names the partners and states no financing on both hosts", async () => {
      const html = await renderPage(config);
      const plate = html.slice(html.indexOf('data-testid="event-partners"'));
      expect(plate).toContain("Партнёр А · Партнёр Б");
      expect(html).not.toMatch(/оплачивает|финансир|Спонсор/u);
    });

    it("020 EARS-10 (gate row 44, H3): the guest gate's sub-line reads «Вход — по почте, две минуты.» on both hosts and carries no «бесплатн»", async () => {
      // The gate is asserted as its own subtree: the sign-up card's «Бесплатно
      // для врача» condition is the Pul-cost fact (020 EARS-12), not the gate.
      document.body.innerHTML = await renderPage(config);
      const gate = screen.getByTestId("recording-gate");
      expect(gate).toHaveTextContent("Вход — по почте, две минуты.");
      expect(gate.textContent).not.toMatch(/бесплатн/iu);
    });

    it("020 Amendment 2026-10-02 (gate row 30, D9): the server renders the hero time in МСК on both hosts", async () => {
      const html = await renderPage(config);
      expect(html).toContain("28 августа, 19:00 (МСК) · 90 минут");
    });
  },
);

describe("020 Amendment 2026-10-02 (gate row 30, D9): the client island re-formats the time", () => {
  it("an online event's hero time reads in the viewer's zone with its label; an offline event stays МСК", () => {
    viewerZone.current = "Asia/Yekaterinburg";
    const { rerender } = render(
      <ViewerZoneTime moment={ENDED} part="dateLine" />,
    );
    expect(
      screen.getByText("28 августа, 21:00 (GMT+5) · 90 минут"),
    ).toBeInTheDocument();
    rerender(
      <ViewerZoneTime
        moment={{ ...ENDED, format: "hybrid" }}
        part="weekdayLabel"
      />,
    );
    expect(screen.getByText("пятница · GMT+5")).toBeInTheDocument();
    rerender(
      <ViewerZoneTime
        moment={{ ...ENDED, format: "offline" }}
        part="dateLine"
      />,
    );
    expect(
      screen.getByText("28 августа, 19:00 (МСК) · 90 минут"),
    ).toBeInTheDocument();
  });
});

describe("020 EARS-19 (gate rows 28–29, D8): the segment's error and loading states", () => {
  it("a failing read renders the canvas error with «Повторить», and the retry re-renders the segment", () => {
    const reset = vi.fn();
    render(<EventPageError reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Не получилось загрузить событие",
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("the route segment's loading state is the canvas skeleton", () => {
    render(<EventPageSkeleton />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Загружаем событие");
    expect(
      region.querySelectorAll('[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(8);
  });
});

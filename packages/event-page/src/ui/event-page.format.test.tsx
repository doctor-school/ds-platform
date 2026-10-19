import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventPageView, ParticipationCta } from "@ds/schemas";

import type { EventPageHostConfig } from "../host-config";

/**
 * Wave-3 PR 3.3 (#2072) — the format block per format (020 EARS-8, gate rows
 * 41, 33), the seats-exhausted switch (EARS-9, row 34), the social proof
 * (EARS-3, row 36), the ended meta row's viewers count (H2, row 43), the two
 * ended-page mismatches of #2072 comment 6217460822 and the EARS-19 state sweep
 * (rows 38, 40) — every case on BOTH host mounts.
 */

const {
  fetchPublicEventPage,
  fetchParticipationCta,
  fetchEventRegistrationState,
  fetchEventPlayback,
  headers,
  push,
  refresh,
} = vi.hoisted(() => ({
  fetchPublicEventPage: vi.fn(),
  fetchParticipationCta: vi.fn(),
  fetchEventRegistrationState: vi.fn(),
  fetchEventPlayback: vi.fn(),
  headers: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@ds/events-storefront/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/events-storefront/server")>()),
  fetchPublicEventPage,
  fetchParticipationCta,
  fetchEventRegistrationState,
}));
vi.mock("../server/event-playback", () => ({ fetchEventPlayback }));
vi.mock("next/headers", () => ({ headers }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push, refresh }),
}));

const { EventPage } = await import("./event-page");
const { FormatTabs } = await import("./format-tabs");

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

const BASE: EventPageView = {
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

const cta = (
  action: ParticipationCta["action"],
  host: EventPageHostConfig,
): ParticipationCta => ({
  action,
  label: {
    register: "Участвовать",
    registered: "Вы записаны",
    "enter-room": "Войти в эфир",
    "switch-to-online": "Участвовать онлайн",
    "sold-out": "Мест нет",
    unavailable: "Участие недоступно",
  }[action],
  href:
    action === "register" || action === "switch-to-online"
      ? `/register?returnTo=${encodeURIComponent(`${host.routes.eventPage}/prp-gonartroz`)}`
      : null,
  reason: action === "unavailable" ? "Событие завершилось" : null,
  presenceCount: null,
});

const GUEST = new Headers({ "user-agent": "vitest" });
const SIGNED_IN = new Headers({
  cookie: "__Host-ds_session=abc",
  "user-agent": "vitest",
});

async function renderPage(
  config: EventPageHostConfig,
  event: EventPageView,
  action: ParticipationCta["action"],
  opts: {
    auth?: "guest" | "signed-in";
    mode?: string;
    from?: string;
    /** Keep a CTA the test mocked itself instead of the default for `action`. */
    keepCta?: boolean;
  } = {},
): Promise<HTMLElement> {
  fetchPublicEventPage.mockResolvedValue(event);
  if (!opts.keepCta) {
    fetchParticipationCta.mockResolvedValue(cta(action, config));
  }
  const signedIn = opts.auth === "signed-in";
  headers.mockResolvedValue(signedIn ? SIGNED_IN : GUEST);
  fetchEventRegistrationState.mockResolvedValue(
    signedIn ? { registered: action === "registered" } : null,
  );
  const html = renderToStaticMarkup(
    await EventPage({
      config,
      params: Promise.resolve({ slug: event.slug }),
      searchParams: Promise.resolve({
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.from ? { from: opts.from } : {}),
      }),
    }),
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host;
}

const byTestId = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  fetchEventPlayback.mockResolvedValue(null);
});
afterEach(cleanup);

describe.each(Object.entries(HOSTS))(
  "wave-3 PR 3.3 on the %s mount",
  (_host, config) => {
    const page = `${config.routes.eventPage}/prp-gonartroz`;

    it("020 EARS-8: an offline event renders the remaining seats, and no ticket or QR, on both hosts", async () => {
      const root = await renderPage(
        config,
        { ...BASE, format: "offline", seatsLeft: 12 },
        "register",
      );
      const block = byTestId(root, "event-format-block");
      expect(block?.getAttribute("data-format-kind")).toBe("offline");
      expect(byTestId(root, "event-format-seats")?.textContent).toBe(
        "Осталось 12 мест",
      );
      expect(block?.textContent).not.toMatch(/билет|QR|откроется/iu);
      expect(root.textContent).not.toMatch(/билет|QR/iu);
    });

    it("020 EARS-8: the hybrid tab is written to the URL, survives reload and back, and defaults to the policy's half", async () => {
      // Default: seats remain → the policy offers registration → «очно».
      let root = await renderPage(
        config,
        { ...BASE, format: "hybrid", seatsLeft: 12 },
        "register",
      );
      const tabs = byTestId(root, "event-format-tabs");
      expect(tabs?.getAttribute("data-mode")).toBe("offline");
      expect(
        root.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      ).toBe("Очно");
      expect(byTestId(root, "event-format-seats")?.textContent).toBe(
        "Осталось 12 мест",
      );

      // Reload with `?mode=online` (a shared link, or back to that entry)
      // reproduces the «онлайн» tab, and the LD-9 return target carries it.
      root = await renderPage(
        config,
        { ...BASE, format: "hybrid", seatsLeft: 12 },
        "register",
        { mode: "online" },
      );
      expect(
        byTestId(root, "event-format-tabs")?.getAttribute("data-mode"),
      ).toBe("online");
      expect(
        root.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
      ).toBe("Онлайн");
      expect(root.textContent).toContain(
        "Комната эфира откроется за 10 минут до начала",
      );
      const register = root.querySelector<HTMLAnchorElement>(
        'a[href^="/register"]',
      );
      expect(register).not.toBeNull();
      const returnTo = new URL(
        register!.getAttribute("href")!,
        "https://host.test",
      ).searchParams.get("returnTo");
      expect(returnTo).toBe(`${page}?mode=online`);

      // A junk value falls back to the policy default, never an empty block.
      root = await renderPage(
        config,
        { ...BASE, format: "hybrid", seatsLeft: 12 },
        "register",
        { mode: "javascript:alert(1)" },
      );
      expect(
        byTestId(root, "event-format-tabs")?.getAttribute("data-mode"),
      ).toBe("offline");
    });

    it("020 EARS-8: switching a hybrid tab pushes a history entry with the tab in the URL (keyboard and pointer)", async () => {
      document.body.replaceChildren();
      render(
        <FormatTabs
          mode="offline"
          tabs={{ offline: "Очно", online: "Онлайн" }}
          hrefs={{
            offline: `${page}?mode=offline`,
            online: `${page}?mode=online`,
          }}
          offline={<p>seats</p>}
          online={<p>room</p>}
        />,
      );
      const online = screen.getByRole("tab", { name: "Онлайн" });
      act(() => {
        fireEvent.mouseDown(online, { button: 0, ctrlKey: false });
      });
      expect(push).toHaveBeenLastCalledWith(`${page}?mode=online`, {
        scroll: false,
      });
      expect(screen.getByText("room")).toBeInTheDocument();
      // Keyboard: arrow keys move between the tabs (Radix roving focus).
      act(() => {
        const current = screen.getByRole("tab", { name: "Онлайн" });
        current.focus();
        fireEvent.keyDown(current, { key: "ArrowLeft" });
      });
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("tab", { name: "Очно" }),
        ),
      );
      await waitFor(() =>
        expect(push).toHaveBeenLastCalledWith(`${page}?mode=offline`, {
          scroll: false,
        }),
      );
      expect(screen.getByText("seats")).toBeInTheDocument();
    });

    it("020 EARS-9: a hybrid event with no seats opens on «онлайн» and says why, on both hosts", async () => {
      const root = await renderPage(
        config,
        { ...BASE, format: "hybrid", seatsLeft: 0 },
        "switch-to-online",
      );
      expect(
        byTestId(root, "event-format-tabs")?.getAttribute("data-mode"),
      ).toBe("online");
      const statement = byTestId(root, "event-format-statement");
      expect(statement?.textContent).toContain("Очных мест не осталось");
      expect(statement?.textContent).toContain("Участвуйте онлайн");
    });

    it("020 EARS-9: a sold-out offline event renders «мест нет», no control and no waiting-list affordance on both hosts (gate row 35)", async () => {
      for (const auth of ["guest", "signed-in"] as const) {
        fetchParticipationCta.mockResolvedValue({
          ...cta("sold-out", config),
          // The api resolver's own sold-out reason (participation-cta.resolver).
          reason: "Очные места закончились, лист ожидания не ведётся",
        });
        const root = await renderPage(
          config,
          { ...BASE, format: "offline", seatsLeft: 0 },
          "sold-out",
          { auth, keepCta: true },
        );
        // «мест нет» stated, in the card and on the format block.
        expect(byTestId(root, "event-page-aside")?.textContent, auth).toMatch(
          /Мест нет/u,
        );
        expect(byTestId(root, "event-format-seats")?.textContent, auth).toBe(
          "Мест не осталось",
        );
        // No participation control of any kind — no link, no button, no
        // one-tap, no tab to switch to.
        expect(byTestId(root, "event-signup-cta"), auth).toBeNull();
        expect(root.querySelector('a[href^="/register"]'), auth).toBeNull();
        expect(
          byTestId(root, "event-page-aside")?.querySelectorAll("a, button")
            .length,
          auth,
        ).toBe(0);
        expect(byTestId(root, "event-format-tabs"), auth).toBeNull();
        // No waiting list offered: no control naming one, no offer in words —
        // the honest «лист ожидания не ведётся» states the opposite.
        expect(
          [...root.querySelectorAll("a, button, input")].filter((node) =>
            /ожидани|очеред|уведом|сообщ/iu.test(node.textContent ?? ""),
          ),
          auth,
        ).toEqual([]);
        expect(root.textContent, auth).not.toMatch(
          /(встать|записаться|запишитесь|встаньте) в (лист ожидания|очередь)|уведомить меня|сообщим,? когда/iu,
        );
        expect(root.textContent, auth).toContain("лист ожидания не ведётся");
      }
    });

    it("020 EARS-8: a hybrid tab switch keeps the room-arrival `from=room` param in the pushed URL", async () => {
      const element = await (async () => {
        fetchPublicEventPage.mockResolvedValue({
          ...BASE,
          format: "hybrid",
          seatsLeft: 12,
        });
        fetchParticipationCta.mockResolvedValue(cta("register", config));
        headers.mockResolvedValue(SIGNED_IN);
        fetchEventRegistrationState.mockResolvedValue({ registered: false });
        return EventPage({
          config,
          params: Promise.resolve({ slug: "prp-gonartroz" }),
          searchParams: Promise.resolve({ from: "room" }),
        });
      })();
      document.body.replaceChildren();
      render(element);
      act(() => {
        fireEvent.mouseDown(screen.getByRole("tab", { name: "Онлайн" }), {
          button: 0,
          ctrlKey: false,
        });
      });
      expect(push).toHaveBeenLastCalledWith(`${page}?from=room&mode=online`, {
        scroll: false,
      });
    });

    it("020 EARS-3: the page count equals the feed card count for one event; zero sign-ups and the hide option render no count; a guest and a signed-in doctor see the same line", async () => {
      const event: EventPageView = {
        ...BASE,
        signUps: { total: 51, sameSpecialty: 37, adjacentSpecialties: 14 },
      };
      const guest = await renderPage(config, event, "register");
      const guestLine = byTestId(guest, "event-signup-proof")?.textContent;
      expect(guestLine).toBe(
        "Уже записался 51 коллегав том числе 14 врачей смежных специальностей",
      );
      const signedIn = await renderPage(config, event, "register", {
        auth: "signed-in",
      });
      expect(byTestId(signedIn, "event-signup-proof")?.textContent).toBe(
        guestLine,
      );
      // `signUps: null` is both «no sign-ups yet» and «hide option on».
      const none = await renderPage(config, BASE, "register");
      expect(byTestId(none, "event-signup-proof")).toBeNull();
      expect(none.textContent).not.toMatch(/записал(ся|ись) 0/u);
    });

    it("020 H2: the ended meta row renders «Смотрели N коллег» from the read, and nothing when it is absent", async () => {
      const ended: EventPageView = { ...BASE, state: "ended", viewers: 214 };
      let root = await renderPage(config, ended, "unavailable");
      const meta = byTestId(root, "event-meta-viewers");
      expect(meta?.textContent).toBe("Смотрели214 коллег");
      root = await renderPage(
        config,
        { ...ended, viewers: null },
        "unavailable",
      );
      expect(byTestId(root, "event-meta-viewers")).toBeNull();
      expect(root.textContent).not.toMatch(/Смотрели/u);
    });

    it("020 H2: the ended meta row states «Эфир прошёл» with the date, with or without a viewers count; never before the end", async () => {
      const ended: EventPageView = { ...BASE, state: "ended", viewers: null };
      const root = await renderPage(config, ended, "unavailable");
      expect(byTestId(root, "event-meta-aired")?.textContent).toBe(
        "Эфир прошёл28 августа 2026",
      );
      const upcoming = await renderPage(config, BASE, "register");
      expect(byTestId(upcoming, "event-meta-aired")).toBeNull();
      expect(upcoming.textContent).not.toMatch(/Эфир прошёл/u);
    });

    it("020 EARS-19: the ended page's sign-up card shows no «Бесплатно для врача» row", async () => {
      const root = await renderPage(
        config,
        { ...BASE, state: "ended" },
        "unavailable",
      );
      expect(root.textContent).not.toMatch(/бесплатн/iu);
    });

    it("020 EARS-19: «Комната эфира откроется за 10 минут до начала» renders only before the start, never on an ended page", async () => {
      for (const format of ["online", "hybrid"] as const) {
        const upcoming = await renderPage(
          config,
          { ...BASE, format, seatsLeft: format === "hybrid" ? 4 : null },
          "register",
          { mode: "online" },
        );
        expect(upcoming.textContent).toContain(
          "Комната эфира откроется за 10 минут до начала",
        );
        for (const state of ["live", "ended", "hidden"] as const) {
          const root = await renderPage(
            config,
            {
              ...BASE,
              format,
              state,
              seatsLeft: format === "hybrid" ? 4 : null,
            },
            state === "live" ? "register" : "unavailable",
            { mode: "online" },
          );
          expect(root.textContent).not.toMatch(/откроется/u);
        }
      }
    });

    it("020 EARS-19: a state sweep over format × phase × auth on both hosts finds no «скоро», no empty labelled box, no disabled control and no Pul statement", async () => {
      const phases = [
        ["published", "register"],
        ["live", "register"],
        ["ended", "unavailable"],
        ["hidden", "unavailable"],
      ] as const;
      for (const format of ["online", "offline", "hybrid"] as const) {
        for (const seatsLeft of format === "online" ? [null] : [null, 0, 9]) {
          for (const [state, action] of phases) {
            for (const auth of ["guest", "signed-in"] as const) {
              const event: EventPageView = {
                ...BASE,
                format,
                state,
                seatsLeft,
                signUps: { total: 5, sameSpecialty: 3, adjacentSpecialties: 2 },
                viewers: state === "ended" ? 40 : null,
              };
              const effective =
                action === "register" && seatsLeft === 0
                  ? format === "hybrid"
                    ? "switch-to-online"
                    : "sold-out"
                  : action;
              const root = await renderPage(config, event, effective, { auth });
              const where = `${format}/${String(seatsLeft)}/${state}/${auth}`;
              // The hero's lifecycle word «Скоро» is the approved status plate;
              // everything else is swept for a deferred-feature marker.
              const body = [
                byTestId(root, "event-page-open-part"),
                byTestId(root, "event-page-aside"),
              ]
                .map((node) => node?.textContent ?? "")
                .join(" ");
              expect(body, where).not.toMatch(/скоро/iu);
              expect(
                root.querySelectorAll(
                  '[disabled], [aria-disabled="true"], a:not([href])',
                ).length,
                where,
              ).toBe(0);
              // No Pul statement: no balance, shortfall, advance or accrual,
              // and at zero cost no Pul word at all.
              expect(root.textContent, where).not.toMatch(
                /Pul|баланс|не хватает|аванс|начисл/u,
              );
              // No empty labelled box: every section says something beyond
              // its heading.
              for (const section of root.querySelectorAll("section")) {
                const heading =
                  section.firstElementChild?.textContent?.trim() ?? "";
                const text = section.textContent?.trim() ?? "";
                expect(text.length, `${where} ${heading}`).toBeGreaterThan(
                  heading.length,
                );
              }
            }
          }
        }
      }
    });
  },
);

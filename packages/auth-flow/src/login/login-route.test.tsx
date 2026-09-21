// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SERVER MOUNT of the sign-in door (#2027 PR 1.5): one route body, two
 * storefronts.
 *
 * These ids arrive verbatim from `apps/doctor/app/(auth)/login/page.tsx`'s own
 * tier. The behaviour they describe — who is redirected before paint, where a
 * carried arrival lands, what survives the hop into `/register` — is no longer a
 * doctor-host composition but the package route, so the assertions follow the
 * code. The rules that are host-NEUTRAL run over both fixtures at the bottom of
 * the file, which is the point of the lift: the same mount, two configurations.
 *
 * Mocked seams, and why each is the honest one:
 *   • `redirect` — Next's own control-flow throw, doubled so a test can never
 *     observe the mount rendering on past a redirect it was supposed to take.
 *   • `resolveServerAuth` / `resolveReturnContext` — the two upstream READS.
 *     The GUARD (`guardAuthRoute`) and the whole return-target codec stay the
 *     real shared ones, so this tier proves the mount routes its decision
 *     through them rather than re-deciding locally.
 *   • `resolveArrivalLanding` keeps its real LD-4 rule, bound to a doubled
 *     `fetch`: what is stubbed is the specialty READ, never the decision.
 */
const { redirect, resolveServerAuth, resolveReturnContext, specialtyFetch } =
  vi.hoisted(() => ({
    redirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    resolveServerAuth: vi.fn(),
    resolveReturnContext: vi.fn(),
    specialtyFetch: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect,
  // The nested client door reads the router; only the mount's redirect is under
  // test here.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
vi.mock("../server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server")>();
  return {
    ...actual,
    resolveServerAuth,
    resolveReturnContext,
    resolveArrivalLanding: (
      host: Parameters<typeof actual.resolveArrivalLanding>[0],
      requestHeaders: Headers,
    ) => actual.resolveArrivalLanding(host, requestHeaders, specialtyFetch),
  };
});

import type { AuthFlowHostConfig } from "../host-config";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";
import { LoginRoute } from "./login-route";

/** The signed-in branch of `ServerAuth` — the claims ride along with it. */
const DOCTOR = {
  status: "doctor",
  claims: { sub: "doctor-1", roles: ["doctor"], mfa: false },
} as const;

const EVENT = {
  time: "19:00",
  dateLabel: "27 августа · чт",
  school: "Школа ортобиологии",
  title: "PRP при гонартрозе",
  specialties: ["Травматология"],
  speakers: [{ name: "Анна Соколова" }],
};

/** The specialty read answering «nothing remembered» — the LD-4 default branch. */
function forgetsSpecialty(): void {
  specialtyFetch.mockResolvedValue({ ok: false, status: 404 } as Response);
}

/** The specialty read answering with a remembered choice (017 EARS-6). */
function remembersSpecialty(): void {
  specialtyFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      specialty: {
        id: "s1",
        code: "kardiologiya",
        name: "Кардиология",
        isOther: false,
      },
      storedIn: "profile",
    }),
  } as Response);
}

type Params = Record<string, string | string[] | undefined>;

/** Render the mount, reporting the redirect target instead of the thrown signal. */
async function landingOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<string | null> {
  try {
    await LoginRoute({ config, searchParams: Promise.resolve(params) });
    return null;
  } catch (error) {
    const message = (error as Error).message;
    if (!message.startsWith("NEXT_REDIRECT:")) throw error;
    return message.slice("NEXT_REDIRECT:".length);
  }
}

/** Every prop the guest mount hands `<LoginDoor />`. */
async function doorOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<ReactElement<{ landing: string; returnTarget?: string | null }>> {
  const shell = (await LoginRoute({
    config,
    searchParams: Promise.resolve(params),
  })) as ReactElement<{ children: ReactElement<never> }>;
  return shell.props.children as ReactElement<{
    landing: string;
    returnTarget?: string | null;
  }>;
}

/** The `landing` the guest door is handed — where sign-in will take them. */
async function guestLandingOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<string> {
  return (await doorOf(config, params)).props.landing;
}

/** An `href` off the rendered door, by its accessible name. */
async function linkHrefOf(
  config: AuthFlowHostConfig,
  params: Params,
  name: string,
): Promise<string | null> {
  render(await doorOf(config, params));
  return screen.getByRole("link", { name }).getAttribute("href");
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetsSpecialty();
  resolveReturnContext.mockResolvedValue(null);
});

afterEach(cleanup);

/**
 * #1955 — a doctor who is ALREADY signed in never sees the sign-in door.
 *
 * `/login` is reachable from anywhere (a bookmark, the 017 guest cluster still
 * painted in a stale tab, a shared link), and rendering a password box to a
 * visitor who already holds a session invites them to re-authenticate for
 * nothing, on a chromeless screen with no way back onto the storefront. The
 * decision is a SERVER one, taken before the first byte of HTML, and it chooses
 * between exactly the landing values the mount already computes.
 */
describe("017 #1955: /login is closed to a doctor who already has a session", () => {
  it("017 #1955.20: a signed-in direct arrival is sent to the LD-4 landing, never shown the form", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf(DOCTOR_FIXTURE, {})).toBe("/");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("017 #1955.21: a signed-in doctor with a remembered specialty lands on the 019 feed", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);
    remembersSpecialty();

    expect(await landingOf(DOCTOR_FIXTURE, {})).toBe("/events");
  });

  it("017 #1955.22: a signed-in GATE arrival goes to the эфир it came from, not the generic landing", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);
    resolveReturnContext.mockResolvedValue(EVENT);

    // The LANDING, not the guard target verbatim: the academy serves the эфир at
    // `/webinars/<slug>` and this host serves the same one at `/events/<slug>`
    // (#1945), so the host projection is where the redirect goes.
    expect(
      await landingOf(DOCTOR_FIXTURE, { returnTo: "/webinars/prp-pri-gonartroze" }),
    ).toBe("/events/prp-pri-gonartroze");
  });

  it("017 #1955.23: a hostile returnTo is not a redirect vector — the guard output lands, never the raw param", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(
      await landingOf(DOCTOR_FIXTURE, { returnTo: "https://evil.example/steal" }),
    ).toBe("/");
  });

  it("017 #1955.24: a guest still gets the door — no redirect, the form renders", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(await landingOf(DOCTOR_FIXTURE, {})).toBe(null);
    expect(redirect).not.toHaveBeenCalled();
  });
});

/**
 * #1987 — `/account` survives the door.
 *
 * The 017 signed-in affordance and a direct `/account` open both send a guest to
 * `/login?returnTo=/account`. The landing vocabulary knew only эфир shapes, so
 * that arrival resolved no landing and sign-in dropped the doctor on the LD-4
 * default — the one destination they had just declined. Both branches of the
 * door are pinned: the signed-in one redirects there, the guest one hands the
 * door the same value to navigate to afterwards.
 */
describe("#1987: an /account arrival comes back to /account", () => {
  it("#1987: a signed-in doctor arriving with returnTo=/account is sent to /account", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf(DOCTOR_FIXTURE, { returnTo: "/account" })).toBe(
      "/account",
    );
    // No эфир to resolve — the account shape carries none, so the mount must not
    // pay for the public event read to find that out.
    expect(resolveReturnContext).not.toHaveBeenCalled();
  });

  it("#1987: a guest arriving with returnTo=/account signs in INTO /account", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(await guestLandingOf(DOCTOR_FIXTURE, { returnTo: "/account" })).toBe(
      "/account",
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it("014 EARS-6.5: a page BELOW the cabinet is a landing in its own right", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    // The family rule of `parseAccountReturnTarget` admits every path under the
    // host's own cabinet route, so the landing must ask the codec rather than
    // compare the target with the cabinet INDEX — otherwise «Мои события»
    // silently degrades to the LD-4 default.
    expect(
      await landingOf(DOCTOR_FIXTURE, { returnTo: "/account/events" }),
    ).toBe("/account/events");
  });

  it("#1987: a hostile look-alike is still the LD-4 landing, never a redirect vector", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(
      await landingOf(DOCTOR_FIXTURE, {
        returnTo: "https://evil.example/account",
      }),
    ).toBe("/");
  });
});

/**
 * #2258 / rule S3 — the hop into `/register` does not drop the target.
 *
 * `/register` is a co-equal auth path, so a doctor who pressed
 * «Зарегистрироваться» from `/login?returnTo=/account` must arrive there still
 * carrying the cabinet. The route built that link from the 021 EARS-3
 * return-context target, which is эфир-only by contract, so every non-эфир
 * arrival lost its target at the hop and signed up into the LD-4 default. The
 * mount's contribution is handing the door the RAW arrival value; the door's
 * shared carry helper answers both shapes and re-appends only what the guards
 * reconstructed — asserted here on the rendered links, end to end.
 */
describe("#2258: the /login → /register hop carries the arrival target", () => {
  beforeEach(() => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });
  });

  it("#2258: an account arrival is carried into /register", async () => {
    expect(
      await linkHrefOf(
        DOCTOR_FIXTURE,
        { returnTo: "/account" },
        "Создать аккаунт",
      ),
    ).toBe("/register?returnTo=%2Faccount");
  });

  it("#2258: the эфир arrival is still carried, unchanged", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    expect(
      await linkHrefOf(
        DOCTOR_FIXTURE,
        { returnTo: "/webinars/prp-pri-gonartroze" },
        "Создать аккаунт",
      ),
    ).toBe("/register?returnTo=%2Fwebinars%2Fprp-pri-gonartroze");
  });

  it("#2258: a hostile target is dropped at the hop, never propagated", async () => {
    expect(
      await linkHrefOf(
        DOCTOR_FIXTURE,
        { returnTo: "https://evil.example/account" },
        "Создать аккаунт",
      ),
    ).toBe("/register");
  });

  it("#2027 S3: «Забыли пароль» carries it too — recovery is an interruption, not a new journey", async () => {
    expect(
      await linkHrefOf(DOCTOR_FIXTURE, { returnTo: "/account" }, "Забыли пароль?"),
    ).toBe("/reset?returnTo=%2Faccount");
    cleanup();
    expect(await linkHrefOf(DOCTOR_FIXTURE, {}, "Забыли пароль?")).toBe("/reset");
    cleanup();
    expect(
      await linkHrefOf(
        DOCTOR_FIXTURE,
        { returnTo: "https://evil.example/account" },
        "Забыли пароль?",
      ),
    ).toBe("/reset");
  });
});

/**
 * The same mount, the other host (#2027 PR 1.5).
 *
 * The Academy ran its #675 guard in a server LAYOUT and its door in a client
 * page, so «already signed in» and «where sign-in leads» were decided in two
 * places that could not see each other. One mount now decides both, and these
 * are the rules that are host-NEUTRAL: the redirect, the hostile-param refusal
 * and the guest's door. The values differ because the CONFIG differs — that is
 * the whole of the host delta.
 */
describe("017 #1955 (Academy): the same rules over the other host config", () => {
  it("017 #1955.20: a signed-in direct arrival is sent to the LD-4 landing, never shown the form", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf(ACADEMY_FIXTURE, {})).toBe("/webinars");
    expect(redirect).toHaveBeenCalledTimes(1);
    // This host states no specialty memory, so the LD-4 read is never issued.
    expect(specialtyFetch).not.toHaveBeenCalled();
  });

  it("017 #1955.23: a hostile returnTo is not a redirect vector — the guard output lands, never the raw param", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(
      await landingOf(ACADEMY_FIXTURE, { returnTo: "https://evil.example/steal" }),
    ).toBe("/webinars");
  });

  it("017 #1955.24: a guest still gets the door — no redirect, the form renders", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(await landingOf(ACADEMY_FIXTURE, {})).toBe(null);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("021 EARS-3: a host that publishes no return-context card never pays for the эфир read", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    const door = await doorOf(ACADEMY_FIXTURE, {
      returnTo: "/webinars/prp-pri-gonartroze",
    });
    // The эфир still COMPLETES after sign-in — the guard reconstruction stands
    // on its own; only the card, which this host does not publish, needed the read.
    expect(door.props.returnTarget).toBe("/webinars/prp-pri-gonartroze");
    expect(resolveReturnContext).not.toHaveBeenCalled();
  });
});

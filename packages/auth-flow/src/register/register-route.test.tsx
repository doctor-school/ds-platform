// @vitest-environment jsdom
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SERVER MOUNT of the sign-up door (#2027 PR 1.6): one route body, two
 * storefronts.
 *
 * The `#2027 S4` ids arrive verbatim from `apps/doctor/app/(auth)/register/
 * page.test.tsx` — the behaviour they describe (where a carried arrival lands,
 * what the hop carries onward) is no longer a doctor-host composition but the
 * package route, so the assertions follow the code. The host-NEUTRAL rules run
 * over BOTH fixtures, which is the point of the lift: the same mount, two
 * configurations.
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
 *
 * The door is read as an ELEMENT rather than rendered: what this tier owns is
 * the server decision handed across the boundary, and the door's own rendering
 * is pinned by `register-door.test.tsx`.
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
import { RegisterRoute } from "./register-route";

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

type Params = Record<string, string | string[] | undefined>;

type DoorProps = {
  landing: string;
  returnTo?: string | null;
  returnTarget?: string | null;
  carriedTarget?: string | null;
  returnContextPlate?: unknown;
};

type ShellProps = {
  children: ReactElement<DoorProps>;
  returnContext?: unknown;
};

/** Render the mount, reporting the redirect target instead of the thrown signal. */
async function landingOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<string | null> {
  try {
    await RegisterRoute({ config, searchParams: Promise.resolve(params) });
    return null;
  } catch (error) {
    const message = (error as Error).message;
    if (!message.startsWith("NEXT_REDIRECT:")) throw error;
    return message.slice("NEXT_REDIRECT:".length);
  }
}

/** The shell the guest mount returns — the frame carrying the panel slot. */
async function shellOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<ReactElement<ShellProps>> {
  return (await RegisterRoute({
    config,
    searchParams: Promise.resolve(params),
  })) as ReactElement<ShellProps>;
}

/** Every prop the guest mount hands `<RegisterDoor />`. */
async function doorOf(
  config: AuthFlowHostConfig,
  params: Params,
): Promise<DoorProps> {
  return (await shellOf(config, params)).props.children.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetsSpecialty();
  resolveReturnContext.mockResolvedValue(null);
});

/**
 * #675 — the sign-up door is closed to a visitor who already holds a session.
 *
 * Offering a second account to a signed-in doctor is the same mistake `/login`
 * makes when it offers a second sign-in, and the decision is a SERVER one: it
 * is taken before the first byte of HTML, from the landing the mount would have
 * published anyway, so the door and the guard can never disagree about where
 * the doctor ends up.
 */
describe("#675: /register is closed to a doctor who already has a session", () => {
  it("#675: a signed-in direct arrival is sent to the LD-4 landing before anything renders", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf(DOCTOR_FIXTURE, {})).toBe("/");
    expect(redirect).toHaveBeenCalledTimes(1);
    // No landing target to honour ⇒ the эфир read is never paid for.
    expect(resolveReturnContext).not.toHaveBeenCalled();
  });

  it("#675: a guest still gets the door — no redirect, the door element is returned", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(await landingOf(DOCTOR_FIXTURE, {})).toBe(null);
    expect(redirect).not.toHaveBeenCalled();
  });
});

/**
 * #2027 S4 — the sign-up door honours the carried target too.
 *
 * These are the doctor host's own ids: the sign-in door has answered the
 * account family since #1987, and the sign-up door had not, so a doctor who
 * arrived from a closed page and chose to REGISTER instead of signing in lost
 * the page. The rule now lives in the shared mount.
 */
describe("#2027 S4: the sign-up door honours the carried target too", () => {
  beforeEach(() => {
    resolveServerAuth.mockResolvedValue(DOCTOR);
  });

  it("#2027 S4: an account arrival lands on the cabinet, not on the LD-4 default", async () => {
    expect(await landingOf(DOCTOR_FIXTURE, { returnTo: "/account" })).toBe(
      "/account",
    );
    expect(resolveReturnContext).not.toHaveBeenCalled();
  });

  it("#2027 S4: a page BELOW the cabinet lands on ITSELF, not on the cabinet index", async () => {
    expect(
      await landingOf(DOCTOR_FIXTURE, { returnTo: "/account/events" }),
    ).toBe("/account/events");
  });

  it("#2027 S4: the эфир arrival still lands on the doctor-host projection", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    expect(
      await landingOf(DOCTOR_FIXTURE, {
        returnTo: "/webinars/prp-pri-gonartroze",
      }),
    ).toBe("/events/prp-pri-gonartroze");
  });

  it("#2027 S4: an arrival carrying NOTHING still lands on the LD-4 default", async () => {
    expect(await landingOf(DOCTOR_FIXTURE, {})).toBe("/");
  });

  it("#2027 S4: a hostile target is refused — neither landing nor hop carries it", async () => {
    expect(
      await landingOf(DOCTOR_FIXTURE, {
        returnTo: "https://evil.example/account",
      }),
    ).toBe("/");
  });
});

/**
 * What the mount hands the door — the four server facts, each a different
 * question (021 EARS-3 / EARS-10, rule S3 / #2258).
 */
describe("#2027 PR 1.6: the props the mount hands the sign-up door", () => {
  beforeEach(() => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });
  });

  it("#2027 PR 1.6: a repeated returnTo degrades to its FIRST value, it never breaks the door", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    const door = await doorOf(DOCTOR_FIXTURE, {
      returnTo: ["/webinars/prp-pri-gonartroze", "/account"],
    });
    expect(door.returnTo).toBe("/webinars/prp-pri-gonartroze");
    expect(door.landing).toBe("/events/prp-pri-gonartroze");
  });

  it("#2027 PR 1.6: the эфир arrival carries landing, raw returnTo, returnTarget and carriedTarget", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    const door = await doorOf(DOCTOR_FIXTURE, {
      returnTo: "/webinars/prp-pri-gonartroze",
    });
    expect(door.landing).toBe("/events/prp-pri-gonartroze");
    expect(door.returnTo).toBe("/webinars/prp-pri-gonartroze");
    // 021 EARS-10 — the эфир intent to COMPLETE, in THIS host's vocabulary.
    expect(door.returnTarget).toBe("/events/prp-pri-gonartroze");
    // Rule S3 — the CARRY vocabulary of the sideways hops, the canonical target.
    expect(door.carriedTarget).toBe("/webinars/prp-pri-gonartroze");
  });

  it("#2258 S3: an account arrival carries onward but names no эфир to complete", async () => {
    const door = await doorOf(DOCTOR_FIXTURE, { returnTo: "/account" });

    expect(door.landing).toBe("/account");
    expect(door.returnTarget ?? null).toBe(null);
    expect(door.carriedTarget).toBe("/account");
  });

  it("#2258 S3: a cross-origin target is dropped at the hop, never propagated", async () => {
    const door = await doorOf(DOCTOR_FIXTURE, {
      returnTo: "https://evil.example/account",
    });

    expect(door.landing).toBe("/");
    expect(door.returnTarget ?? null).toBe(null);
    expect(door.carriedTarget ?? null).toBe(null);
  });

  it("021 EARS-2: a doctor-host gate arrival fills BOTH return-context slots", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    const shell = await shellOf(DOCTOR_FIXTURE, {
      returnTo: "/webinars/prp-pri-gonartroze",
    });
    expect(shell.props.returnContext).toBeTruthy();
    expect(shell.props.children.props.returnContextPlate).toBeTruthy();
  });

  it("021 EARS-3: a direct arrival fills NEITHER slot — absent, never an empty frame", async () => {
    const shell = await shellOf(DOCTOR_FIXTURE, {});

    expect(shell.props.returnContext ?? null).toBe(null);
    expect(shell.props.children.props.returnContextPlate ?? null).toBe(null);
  });
});

/**
 * The same mount, the other host (#2027 PR 1.6).
 *
 * The Academy's `/register` was a client page with its guard in a server
 * layout, so «already signed in» and «where sign-up leads» were decided in two
 * places that could not see each other. One mount now decides both, and these
 * are the rules that are host-NEUTRAL: the values differ because the CONFIG
 * differs — that is the whole of the host delta.
 */
describe("#2027 PR 1.6 (Academy): the same mount over the other host config", () => {
  it("#675: a signed-in direct arrival is sent to this host's own landing", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf(ACADEMY_FIXTURE, {})).toBe("/webinars");
    expect(redirect).toHaveBeenCalledTimes(1);
    // This host states no specialty memory, so the LD-4 read is never issued.
    expect(specialtyFetch).not.toHaveBeenCalled();
  });

  it("#2027 S4: a hostile returnTo is not a redirect vector on this host either", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(
      await landingOf(ACADEMY_FIXTURE, {
        returnTo: "https://evil.example/steal",
      }),
    ).toBe("/webinars");
  });

  it("021 EARS-3: a host that publishes no return-context card never pays for the эфир read", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    const shell = await shellOf(ACADEMY_FIXTURE, {
      returnTo: "/webinars/prp-pri-gonartroze",
    });
    // The эфир still COMPLETES after sign-up — the guard reconstruction stands
    // on its own; only the card, which this host does not publish, needed the read.
    expect(shell.props.children.props.returnTarget).toBe(
      "/webinars/prp-pri-gonartroze",
    );
    expect(shell.props.returnContext ?? null).toBe(null);
    expect(shell.props.children.props.returnContextPlate ?? null).toBe(null);
    expect(resolveReturnContext).not.toHaveBeenCalled();
  });
});

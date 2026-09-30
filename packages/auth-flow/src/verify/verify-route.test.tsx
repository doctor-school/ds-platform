// @vitest-environment jsdom
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SERVER MOUNT of the confirmation step (#2027 PR 1.7) for a host that
 * serves `routes.verify` — the sibling of `RegisterRoute`, read as an ELEMENT:
 * this tier owns the server decision handed across the boundary, and the body's
 * own behaviour is pinned by `verify-door.test.tsx`.
 *
 * Mocked seams: Next's `redirect` throw, and the two upstream READS
 * (`resolveServerAuth`, `resolveReturnContext`). The guard, the landing rule and
 * the return-target codec stay the real shared ones.
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
// `resolveArrivalLanding` keeps its real LD-4 rule, bound to a doubled `fetch`:
// what is stubbed is the specialty READ, never the decision.
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
import { VerifyRoute } from "./verify-route";

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

type Params = Record<string, string | string[] | undefined>;
type StepProps = {
  config: AuthFlowHostConfig;
  landing: string;
  returnTarget?: string | null;
  carriedTarget?: string | null;
  returnContextPlate?: unknown;
};
type ShellProps = {
  children: ReactElement<StepProps>;
  returnContext?: unknown;
};
type GateProps = {
  config: AuthFlowHostConfig;
  email?: string;
  returnTo: string | null;
  children: ReactElement<ShellProps>;
};

async function gateOf(config: AuthFlowHostConfig, params: Params) {
  return (await VerifyRoute({
    config,
    searchParams: Promise.resolve(params),
  })) as ReactElement<GateProps>;
}

async function shellOf(config: AuthFlowHostConfig, params: Params) {
  return (await gateOf(config, params)).props.children;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveServerAuth.mockResolvedValue({ status: "guest" });
  resolveReturnContext.mockResolvedValue(null);
  specialtyFetch.mockResolvedValue({ ok: false, status: 404 } as Response);
});

describe("#2027 PR 1.7: the /verify mount", () => {
  it("#675: a doctor who already holds a session is sent to the landing the registration door would send them to, before anything renders", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    await expect(shellOf(ACADEMY_FIXTURE, {})).rejects.toThrow(
      "NEXT_REDIRECT:/webinars",
    );
  });

  it("003 EARS-24: the same-tab hop's ?email= reaches the client gate, and the step lands where the registration door would", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);
    const gate = await gateOf(ACADEMY_FIXTURE, {
      email: ["doc@example.com", "other@example.com"],
      returnTo: "/webinars/ahilles-042",
    });
    const shell = gate.props.children;

    expect(gate.props).toMatchObject({
      config: ACADEMY_FIXTURE,
      email: "doc@example.com",
      returnTo: "/webinars/ahilles-042",
    });
    expect(shell.props.children.props).toMatchObject({
      config: ACADEMY_FIXTURE,
      landing: "/webinars/ahilles-042",
      returnTarget: "/webinars/ahilles-042",
      carriedTarget: "/webinars/ahilles-042",
    });
    // 021 EARS-10 (#2455) — whether the эфир still exists is asked on every
    // host; only a host that publishes the card also draws it.
    expect(resolveReturnContext).toHaveBeenCalledWith("/webinars/ahilles-042");
    expect(shell.props.returnContext ?? null).toBe(null);
    expect(shell.props.children.props.returnContextPlate ?? null).toBe(null);
  });

  it("021 EARS-3: a host that publishes the card shows the carried эфир beside the confirmation", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);
    const withCard = { ...ACADEMY_FIXTURE, returnTo: { card: true } };

    const shell = await shellOf(withCard, {
      returnTo: "/webinars/ahilles-042",
    });

    expect(shell.props.returnContext).toBeTruthy();
    // The mobile plate above the card, as the registration door draws it.
    expect(shell.props.children.props.returnContextPlate).toBeTruthy();
  });

  it("003 EARS-40: a bare arrival hands the client gate no address, and the gate wraps the WHOLE frame (shell and panel)", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);
    const withCard = { ...ACADEMY_FIXTURE, returnTo: { card: true } };

    const gate = await gateOf(withCard, { returnTo: "/webinars/ahilles-042" });

    expect(gate.props.email).toBeUndefined();
    expect(gate.props.returnTo).toBe("/webinars/ahilles-042");
    // The shell with its return-context panel is INSIDE the gate, so nothing
    // of the frame paints while the gate decides (it renders null until then).
    expect(gate.props.children.props.returnContext).toBeTruthy();
  });

  it("003 EARS-24 (#2455): the doctor storefront mounts the same step, handed the targets its registration door resolved", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    const gate = await gateOf(DOCTOR_FIXTURE, {
      email: "doc@example.com",
      returnTo: "/webinars/prp-pri-gonartroze",
    });
    const shell = gate.props.children;

    expect(gate.props.email).toBe("doc@example.com");
    // 021 EARS-10 — the resolved эфир, projected onto THIS host's paths, is the
    // landing AND what 005 EARS-2 completes; the sideways hops carry the rule S3
    // vocabulary.
    expect(shell.props.children.props).toMatchObject({
      config: DOCTOR_FIXTURE,
      landing: "/events/prp-pri-gonartroze",
      returnTarget: "/events/prp-pri-gonartroze",
      carriedTarget: "/webinars/prp-pri-gonartroze",
    });
    // 021 EARS-2 — the arrival card and plate the form stood beside stay.
    expect(shell.props.returnContext).toBeTruthy();
    expect(shell.props.children.props.returnContextPlate).toBeTruthy();
  });

  it.each([
    ["Витрина", DOCTOR_FIXTURE],
    ["Академия", ACADEMY_FIXTURE],
  ])(
    "021 EARS-10 (#2455, owner decision Б): on %s an эфир that no longer exists is no target — the confirmed doctor lands on the default landing",
    async (_host, config) => {
      resolveReturnContext.mockResolvedValue(null);

      const shell = await shellOf(config, {
        email: "doc@example.com",
        returnTo: "/webinars/gone",
      });

      // The LD-4 arrival decision (no remembered specialty here → the host default).
      expect(shell.props.children.props).toMatchObject({
        landing: config.landing.afterLogin,
        returnTarget: null,
      });
    },
  );

  it.each([
    ["Витрина", DOCTOR_FIXTURE, "/events/prp-pri-gonartroze"],
    ["Академия", ACADEMY_FIXTURE, "/webinars/prp-pri-gonartroze"],
  ])(
    "021 EARS-10 (#2455, owner decision Б): on %s an эфир that ended or filled up is still the target — its page states that itself",
    async (_host, config, page) => {
      // The public read answers for an ended / full эфир exactly as for a live
      // one: the page exists, so it is where the confirmed doctor lands.
      resolveReturnContext.mockResolvedValue(EVENT);

      const shell = await shellOf(config, {
        email: "doc@example.com",
        returnTo: "/webinars/prp-pri-gonartroze",
      });

      expect(shell.props.children.props).toMatchObject({
        landing: page,
        returnTarget: page,
      });
    },
  );

  it("#675 (#2455): a signed-in doctor on the storefront /verify is sent to the эфир they carried, never shown a second confirmation", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);
    resolveReturnContext.mockResolvedValue(EVENT);

    await expect(
      shellOf(DOCTOR_FIXTURE, {
        email: "doc@example.com",
        returnTo: "/webinars/prp-pri-gonartroze",
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/events/prp-pri-gonartroze");
  });
});

/**
 * #2333 — the confirmation mount mirrors the login and registration mounts: the
 * signed-in re-decision is handed to the step only where it can change the
 * landing — a specialty-aware host whose landing is the LD-4 arrival decision.
 * A validated carried target is final (005 EARS-2), so it gets none.
 */
describe("021 EARS-3 (#2333): the /verify step gets the signed-in re-decision where it can change", () => {
  // The doctor storefront: specialty-aware, and served by this mount (#2455).
  const SPECIALTY_AWARE_WITH_VERIFY: AuthFlowHostConfig = DOCTOR_FIXTURE;
  type ActionProps = { resolveSignedInLanding?: () => Promise<string> };

  async function actionOf(config: AuthFlowHostConfig, params: Params) {
    const shell = await shellOf(config, params);
    return (shell.props.children as unknown as ReactElement<ActionProps>).props
      .resolveSignedInLanding;
  }

  it("021 EARS-3: a direct arrival on a specialty-aware host carries the re-decision", async () => {
    expect(await actionOf(SPECIALTY_AWARE_WITH_VERIFY, {})).toBeTypeOf(
      "function",
    );
  });

  it("005 EARS-2: a carried validated returnTo is the landing — nothing to re-decide", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);
    expect(
      await actionOf(SPECIALTY_AWARE_WITH_VERIFY, {
        returnTo: "/events/prp-pri-gonartroze",
      }),
    ).toBeUndefined();
  });

  it("021 EARS-3: the Academy's constant landing gets no re-decision", async () => {
    expect(await actionOf(ACADEMY_FIXTURE, {})).toBeUndefined();
    expect(
      await actionOf(ACADEMY_FIXTURE, { returnTo: "/webinars/ahilles-042" }),
    ).toBeUndefined();
  });
});

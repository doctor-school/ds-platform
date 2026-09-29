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
  returnTo: string | null;
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
  it("#675: a doctor who already holds a session is sent to the account before anything renders", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    await expect(shellOf(ACADEMY_FIXTURE, {})).rejects.toThrow(
      "NEXT_REDIRECT:/account",
    );
  });

  it("003 EARS-24: the same-tab hop's ?email= and the RAW returnTo reach the client body with the LD landing", async () => {
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
      landing: "/webinars",
      returnTo: "/webinars/ahilles-042",
    });
    // A host that publishes no return-context card never pays for the read.
    expect(resolveReturnContext).not.toHaveBeenCalled();
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

  it("rows 51, 76: a host with no /verify route cannot mount it — a wiring mistake reads as one", async () => {
    await expect(shellOf(DOCTOR_FIXTURE, {})).rejects.toThrow(/verify/);
  });
});

/**
 * #2333 — the confirmation mount mirrors the login and registration mounts: the
 * signed-in re-decision is handed to the step only where it can change the
 * landing — a specialty-aware host whose landing is the LD-4 arrival decision.
 * A validated carried target is final (005 EARS-2), so it gets none.
 */
describe("021 EARS-3 (#2333): the /verify step gets the signed-in re-decision where it can change", () => {
  // No shipped specialty-aware host serves `/verify` (the doctor storefront
  // confirms inline); the package mount still owns the decision for one that does.
  const SPECIALTY_AWARE_WITH_VERIFY: AuthFlowHostConfig = {
    ...DOCTOR_FIXTURE,
    routes: { ...DOCTOR_FIXTURE.routes, verify: "/verify" },
  };
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

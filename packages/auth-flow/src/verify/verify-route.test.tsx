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
const { redirect, resolveServerAuth, resolveReturnContext } = vi.hoisted(
  () => ({
    redirect: vi.fn((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    }),
    resolveServerAuth: vi.fn(),
    resolveReturnContext: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
vi.mock("../server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server")>()),
  resolveServerAuth,
  resolveReturnContext,
}));

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
type EntryProps = {
  config: AuthFlowHostConfig;
  email?: string;
  landing: string;
  returnTo: string | null;
};
type ShellProps = {
  children: ReactElement<EntryProps>;
  returnContext?: unknown;
};

async function shellOf(config: AuthFlowHostConfig, params: Params) {
  return (await VerifyRoute({
    config,
    searchParams: Promise.resolve(params),
  })) as ReactElement<ShellProps>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveServerAuth.mockResolvedValue({ status: "guest" });
  resolveReturnContext.mockResolvedValue(null);
});

describe("#2027 PR 1.7: the /verify mount", () => {
  it("#675: a doctor who already holds a session is sent to the account before anything renders", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    await expect(shellOf(ACADEMY_FIXTURE, {})).rejects.toThrow(
      "NEXT_REDIRECT:/account",
    );
  });

  it("003 EARS-24: the same-tab hop's ?email= and the RAW returnTo reach the client body with the LD landing", async () => {
    const shell = await shellOf(ACADEMY_FIXTURE, {
      email: ["doc@example.com", "other@example.com"],
      returnTo: "/webinars/ahilles-042",
    });

    expect(shell.props.children.props).toMatchObject({
      config: ACADEMY_FIXTURE,
      email: "doc@example.com",
      landing: "/webinars",
      returnTo: "/webinars/ahilles-042",
    });
    // A host that publishes no return-context card never pays for the read.
    expect(resolveReturnContext).not.toHaveBeenCalled();
    expect(shell.props.returnContext ?? null).toBe(null);
  });

  it("021 EARS-3: a host that publishes the card shows the carried эфир beside the confirmation", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);
    const withCard = { ...ACADEMY_FIXTURE, returnTo: { card: true } };

    const shell = await shellOf(withCard, {
      returnTo: "/webinars/ahilles-042",
    });

    expect(shell.props.returnContext).toBeTruthy();
  });

  it("rows 51, 76: a host with no /verify route cannot mount it — a wiring mistake reads as one", async () => {
    await expect(shellOf(DOCTOR_FIXTURE, {})).rejects.toThrow(/verify/);
  });
});

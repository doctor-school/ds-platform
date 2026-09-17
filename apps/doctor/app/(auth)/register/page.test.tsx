import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * #2027 rule S4 — where the SIGN-UP door takes a doctor who arrived from a
 * closed page.
 *
 * The sign-in door has honoured an account arrival since #1987. The sign-up door
 * beside it had only the эфир branch, so a doctor bounced off `/account` who
 * chose «Зарегистрироваться» instead of «Войти» still landed on the LD-4
 * default — precisely the destination they declined by asking for the cabinet.
 *
 * The decision is pinned HERE because it is a SERVER decision taken before the
 * first byte of HTML, on the same `landing` expression the route already
 * computes: the browser tier proves the journey, this proves WHERE every arrival
 * shape lands.
 */
const {
  redirect,
  resolveServerAuth,
  resolveRememberedSpecialty,
  resolveReturnContext,
} = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveServerAuth: vi.fn(),
  resolveRememberedSpecialty: vi.fn(),
  resolveReturnContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
// The session read and the upstream эфир read are doubled; the GUARD and the
// whole return-context codec stay the REAL shared ones, so this tier proves the
// route routes its decision through them rather than through a fixture.
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth,
}));
vi.mock("@/lib/specialty-choice", () => ({ resolveRememberedSpecialty }));
vi.mock("@/lib/return-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/return-context")>()),
  resolveReturnContext,
}));

import DoctorRegisterPage from "@/app/(auth)/register/page";

const GUEST = { status: "guest" } as const;

const EVENT = {
  time: "19:00",
  dateLabel: "27 августа · чт",
  school: "Школа ортобиологии",
  title: "PRP при гонартрозе",
  specialties: ["Травматология"],
  speakers: [{ name: "Анна Соколова" }],
};

/** Every prop the guest door hands `<RegistrationScreen />`. */
async function screenPropsOf(
  params: Record<string, string | string[] | undefined>,
): Promise<{
  landing: string;
  returnTarget?: string;
  carriedTarget?: string;
}> {
  const shell = (await DoctorRegisterPage({
    searchParams: Promise.resolve(params),
  })) as ReactElement<{
    children: ReactElement<{
      landing: string;
      returnTarget?: string;
      carriedTarget?: string;
    }>;
  }>;
  return shell.props.children.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveServerAuth.mockResolvedValue(GUEST);
  resolveRememberedSpecialty.mockResolvedValue({ choice: null });
  resolveReturnContext.mockResolvedValue(null);
});

describe("#2027 S4: the sign-up door honours the carried target too", () => {
  it("#2027 S4: an account arrival lands on the cabinet, not on the LD-4 default", async () => {
    const props = await screenPropsOf({ returnTo: "/account" });

    expect(props.landing).toBe("/account");
    // The account family resolves NO эфир, so the confirm command's эфир-only
    // intent stays absent — but the hop vocabulary still carries the page.
    expect(props.returnTarget).toBeUndefined();
    expect(props.carriedTarget).toBe("/account");
  });

  it("#2027 S4: a page BELOW the cabinet lands on ITSELF, not on the cabinet index", async () => {
    const props = await screenPropsOf({ returnTo: "/account/events" });

    expect(props.landing).toBe("/account/events");
    expect(props.carriedTarget).toBe("/account/events");
  });

  it("#2027 S4: the эфир arrival still lands on the doctor-host projection", async () => {
    resolveReturnContext.mockResolvedValue(EVENT);

    const props = await screenPropsOf({ returnTo: "/webinars/prp" });

    expect(props.landing).toBe("/events/prp");
    expect(props.returnTarget).toBe("/events/prp");
  });

  it("#2027 S4: an arrival carrying NOTHING still lands on the LD-4 default", async () => {
    expect((await screenPropsOf({})).landing).toBe("/");
  });

  it("#2027 S4: a hostile target is refused — neither landing nor hop carries it", async () => {
    const props = await screenPropsOf({ returnTo: "https://evil.example/x" });

    expect(props.landing).toBe("/");
    expect(props.carriedTarget).toBeUndefined();
  });
});

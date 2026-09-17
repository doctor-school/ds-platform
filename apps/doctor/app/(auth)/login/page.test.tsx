import type { ReactElement } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * #1955 — a doctor who is ALREADY signed in never sees the sign-in door.
 *
 * `/login` is reachable from anywhere (a bookmark, the 017 guest cluster still
 * painted in a stale tab, a shared link), and it rendered its form regardless of
 * whether the visitor already had a session. Presenting a signed-in doctor with
 * a password box is not a cosmetic defect: it invites them to re-authenticate a
 * session they already hold, and the door has no way back onto the storefront
 * because the `(auth)` group is chromeless by design.
 *
 * The decision is pinned HERE rather than only in the browser because it is a
 * SERVER decision taken before the first byte of HTML — the same reason
 * `@ds/auth-flow/server` `resolveServerAuth` exists — and because the branches it
 * chooses between
 * (the gate target vs. the LD-4 direct-arrival landing) are exactly the landing
 * vocabulary the route already computes. The browser tier
 * (`e2e/login-arrival.spec.ts`) proves the redirect actually happens against a
 * real api double; this proves WHERE it goes, for every arrival shape.
 */
const {
  redirect,
  resolveServerAuth,
  resolveRememberedSpecialty,
  resolveReturnContext,
} = vi.hoisted(() => ({
  // `redirect()` never returns in Next — it throws a control-flow signal the
  // framework catches. The double throws too, so a test can never observe the
  // route continuing to render past a redirect it was supposed to take.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveServerAuth: vi.fn(),
  resolveRememberedSpecialty: vi.fn(),
  resolveReturnContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
  // The nested client screen reads the router; only the route's own redirect is
  // under test here.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
// The session read is doubled; the GUARD is not. `guardAuthRoute` stays the
// real shared one (#2027 PR 1.4) so this tier proves the route actually routes
// its #1955 decision through it, and `@/lib/return-context` keeps the real
// `serverApiBase` / `parseAccountReturnTarget` it imports from the same module.
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth,
}));
vi.mock("@/lib/specialty-choice", () => ({ resolveRememberedSpecialty }));
vi.mock("@/lib/return-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/return-context")>()),
  resolveReturnContext,
}));

import DoctorLoginPage from "@/app/(auth)/login/page";

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

/** Render the route, reporting the redirect target instead of the thrown signal. */
async function landingOf(
  params: Record<string, string | string[] | undefined>,
): Promise<string | null> {
  try {
    await DoctorLoginPage({ searchParams: Promise.resolve(params) });
    return null;
  } catch (error) {
    const message = (error as Error).message;
    if (!message.startsWith("NEXT_REDIRECT:")) throw error;
    return message.slice("NEXT_REDIRECT:".length);
  }
}

/** The `landing` the guest door hands its screen — where sign-in will take them. */
async function guestLandingOf(
  params: Record<string, string | string[] | undefined>,
): Promise<string> {
  return (await screenPropsOf(params)).landing;
}

/** Every prop the guest door hands `<LoginScreen />`. */
async function screenPropsOf(
  params: Record<string, string | string[] | undefined>,
): Promise<{ landing: string; registerHref: string; resetHref: string }> {
  const shell = (await DoctorLoginPage({
    searchParams: Promise.resolve(params),
  })) as ReactElement<{
    children: ReactElement<{
      landing: string;
      registerHref: string;
      resetHref: string;
    }>;
  }>;
  return shell.props.children.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveRememberedSpecialty.mockResolvedValue({ choice: null });
  resolveReturnContext.mockResolvedValue(null);
});

describe("017 #1955: /login is closed to a doctor who already has a session", () => {
  it("017 #1955.20: a signed-in direct arrival is sent to the LD-4 landing, never shown the form", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf({})).toBe("/");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("017 #1955.21: a signed-in doctor with a remembered specialty lands on the 019 feed", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);
    resolveRememberedSpecialty.mockResolvedValue({
      choice: {
        specialty: {
          id: "s1",
          code: "kardiologiya",
          name: "Кардиология",
          isOther: false,
        },
      },
    });

    expect(await landingOf({})).toBe("/events");
  });

  it("017 #1955.22: a signed-in GATE arrival goes to the эфир it came from, not the generic landing", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);
    resolveReturnContext.mockResolvedValue(EVENT);

    // The LANDING, not the guard target verbatim: the academy serves the эфир at
    // `/webinars/<slug>` and this host serves the same one at `/events/<slug>`
    // (#1945), so the doctor-host projection is where the redirect goes.
    expect(await landingOf({ returnTo: "/webinars/prp-pri-gonartroze" })).toBe(
      "/events/prp-pri-gonartroze",
    );
  });

  it("017 #1955.23: a hostile returnTo is not a redirect vector — the guard output lands, never the raw param", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf({ returnTo: "https://evil.example/steal" })).toBe(
      "/",
    );
  });

  it("017 #1955.24: a guest still gets the door — no redirect, the form renders", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(await landingOf({})).toBe(null);
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
 * screen the same value to navigate to afterwards.
 */
describe("#1987: an /account arrival comes back to /account", () => {
  it("#1987: a signed-in doctor arriving with returnTo=/account is sent to /account", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf({ returnTo: "/account" })).toBe("/account");
    // No эфир to resolve — the account shape carries none, so the route must not
    // pay for the public event read to find that out.
    expect(resolveReturnContext).not.toHaveBeenCalled();
  });

  it("#1987: a guest arriving with returnTo=/account signs in INTO /account", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(await guestLandingOf({ returnTo: "/account" })).toBe("/account");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("014 EARS-6.5: a page BELOW the cabinet is a landing in its own right", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    // The family rule of `parseAccountReturnTarget` admits every path under the
    // host's own cabinet route, so the landing must ask the codec rather than
    // compare the target with the cabinet INDEX — otherwise «Мои события»
    // silently degrades to the LD-4 default.
    expect(await landingOf({ returnTo: "/account/events" })).toBe(
      "/account/events",
    );
  });

  it("#1987: a hostile look-alike is still the LD-4 landing, never a redirect vector", async () => {
    resolveServerAuth.mockResolvedValue(DOCTOR);

    expect(await landingOf({ returnTo: "https://evil.example/account" })).toBe(
      "/",
    );
  });
});

/**
 * #2258 / rule S3 — the hop into `/register` does not drop the target.
 *
 * `/register` is a co-equal auth path, so a doctor who pressed
 * «Зарегистрироваться» from `/login?returnTo=/account` must arrive there still
 * carrying the cabinet. The route built that link from the 021 EARS-3
 * return-context target, which is эфир-only by contract, so every non-эфир
 * arrival lost its target at the hop and signed up into the LD-4 default.
 */
describe("#2258: the /login → /register hop carries the arrival target", () => {
  it("#2258: an account arrival is carried into /register", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect((await screenPropsOf({ returnTo: "/account" })).registerHref).toBe(
      "/register?returnTo=%2Faccount",
    );
  });

  it("#2258: the эфир arrival is still carried, unchanged", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });
    resolveReturnContext.mockResolvedValue(EVENT);

    expect(
      (await screenPropsOf({ returnTo: "/webinars/prp-pri-gonartroze" }))
        .registerHref,
    ).toBe("/register?returnTo=%2Fwebinars%2Fprp-pri-gonartroze");
  });

  it("#2258: a hostile target is dropped at the hop, never propagated", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect(
      (await screenPropsOf({ returnTo: "https://evil.example/account" }))
        .registerHref,
    ).toBe("/register");
  });

  it("#2027 S3: «Забыли пароль» carries it too — recovery is an interruption, not a new journey", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    expect((await screenPropsOf({ returnTo: "/account" })).resetHref).toBe(
      "/reset?returnTo=%2Faccount",
    );
    expect((await screenPropsOf({})).resetHref).toBe("/reset");
    expect(
      (await screenPropsOf({ returnTo: "https://evil.example/account" }))
        .resetHref,
    ).toBe("/reset");
  });
});

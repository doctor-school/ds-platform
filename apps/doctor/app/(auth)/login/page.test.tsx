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
 * `lib/shell-auth.ts` exists — and because the two branches it chooses between
 * (the gate target vs. the LD-4 direct-arrival landing) are exactly the landing
 * vocabulary the route already computes. The browser tier
 * (`e2e/login-arrival.spec.ts`) proves the redirect actually happens against a
 * real api double; this proves WHERE it goes, for every arrival shape.
 */
const {
  redirect,
  resolveShellAuth,
  resolveRememberedSpecialty,
  resolveReturnContext,
} = vi.hoisted(() => ({
  // `redirect()` never returns in Next — it throws a control-flow signal the
  // framework catches. The double throws too, so a test can never observe the
  // route continuing to render past a redirect it was supposed to take.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveShellAuth: vi.fn(),
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
vi.mock("@/lib/shell-auth", () => ({ resolveShellAuth }));
vi.mock("@/lib/specialty-choice", () => ({ resolveRememberedSpecialty }));
vi.mock("@/lib/return-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/return-context")>()),
  resolveReturnContext,
}));

import DoctorLoginPage from "@/app/(auth)/login/page";

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

beforeEach(() => {
  vi.clearAllMocks();
  resolveRememberedSpecialty.mockResolvedValue({ choice: null });
  resolveReturnContext.mockResolvedValue(null);
});

describe("017 #1955: /login is closed to a doctor who already has a session", () => {
  it("017 #1955.20: a signed-in direct arrival is sent to the LD-4 landing, never shown the form", async () => {
    resolveShellAuth.mockResolvedValue({ status: "doctor" });

    expect(await landingOf({})).toBe("/");
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("017 #1955.21: a signed-in doctor with a remembered specialty lands on the 019 feed", async () => {
    resolveShellAuth.mockResolvedValue({ status: "doctor" });
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
    resolveShellAuth.mockResolvedValue({ status: "doctor" });
    resolveReturnContext.mockResolvedValue(EVENT);

    // The LANDING, not the guard target verbatim: the academy serves the эфир at
    // `/webinars/<slug>` and this host serves the same one at `/events/<slug>`
    // (#1945), so the doctor-host projection is where the redirect goes.
    expect(await landingOf({ returnTo: "/webinars/prp-pri-gonartroze" })).toBe(
      "/events/prp-pri-gonartroze",
    );
  });

  it("017 #1955.23: a hostile returnTo is not a redirect vector — the guard output lands, never the raw param", async () => {
    resolveShellAuth.mockResolvedValue({ status: "doctor" });

    expect(await landingOf({ returnTo: "https://evil.example/steal" })).toBe(
      "/",
    );
  });

  it("017 #1955.24: a guest still gets the door — no redirect, the form renders", async () => {
    resolveShellAuth.mockResolvedValue({ status: "guest" });

    expect(await landingOf({})).toBe(null);
    expect(redirect).not.toHaveBeenCalled();
  });
});

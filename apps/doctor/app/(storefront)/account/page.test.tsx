import { describe, expect, it, vi } from "vitest";

const { redirect, resolveServerAuth } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveServerAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Only the session read is doubled: the shared carry helper the bounce is now
// built with keeps the REAL codec it imports from this same module.
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth,
}));
vi.mock("@/components/account-screen", () => ({
  AccountScreen: () => null,
}));

import DoctorAccountPage from "./page";

/**
 * #1958 — the server half of `doctor.school/account`: who is let in.
 *
 * The branch is the 017 EARS-1 one, taken through the SAME `resolveServerAuth`
 * read the shell header branches on — so a guest can never be handed a frame of
 * someone's cabinet, and the arrival carries the canonical 005 EARS-2
 * `?returnTo=/account` so signing in lands back here.
 */
describe("017 #1958: the doctor account route", () => {
  it("017 EARS-1: a guest is redirected to the door carrying ?returnTo=/account, and the cabinet never renders", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    await expect(DoctorAccountPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faccount");
  });

  it("017 EARS-1: a signed-in doctor gets the account screen and no redirect", async () => {
    redirect.mockClear();
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "doctor-1", roles: ["doctor"], mfa: false },
    });

    const element = await DoctorAccountPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(element).not.toBeNull();
  });
});

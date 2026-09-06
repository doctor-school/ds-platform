import { describe, expect, it, vi } from "vitest";

const { redirect, resolveShellAuth } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveShellAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/shell-auth", () => ({ resolveShellAuth }));
vi.mock("@/components/account-screen", () => ({
  AccountScreen: () => null,
}));

import DoctorAccountPage from "./page";

/**
 * #1958 — the server half of `doctor.school/account`: who is let in.
 *
 * The branch is the 017 EARS-1 one, taken through the SAME `resolveShellAuth`
 * read the shell header branches on — so a guest can never be handed a frame of
 * someone's cabinet, and the arrival carries the canonical 005 EARS-2
 * `?returnTo=/account` so signing in lands back here.
 */
describe("017 #1958: the doctor account route", () => {
  it("017 EARS-1: a guest is redirected to the door carrying ?returnTo=/account, and the cabinet never renders", async () => {
    resolveShellAuth.mockResolvedValue({ status: "guest" });

    await expect(DoctorAccountPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faccount");
  });

  it("017 EARS-1: a signed-in doctor gets the account screen and no redirect", async () => {
    redirect.mockClear();
    resolveShellAuth.mockResolvedValue({ status: "doctor" });

    const element = await DoctorAccountPage();

    expect(redirect).not.toHaveBeenCalled();
    expect(element).not.toBeNull();
  });
});

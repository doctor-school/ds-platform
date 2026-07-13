import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthShell } from "./auth-shell";

/**
 * #675 — the auth-surface guard. `<AuthShell>` wraps all four portal auth surfaces
 * (`/login`, `/register`, `/reset`, `/verify`), so guarding it once redirects an
 * ALREADY-authenticated visitor away from every one of them with no auth form
 * rendered. This CI-runnable unit test pins the branches of that guard:
 *   • authenticated (`session()` resolves to claims) → `router.replace("/account")`
 *     AND the wrapped child never appears;
 *   • anonymous (`session()` resolves to `null`) → the child renders, `replace` is
 *     never called;
 *   • `allowAuthenticated` (the /reset exemption, #770 rework / 003 EARS-28: the
 *     /account change-password action hands off to the EXISTING /reset flow, so
 *     a logged-in doctor must reach it) → the child renders with NO session read
 *     and NO redirect.
 * The live end-to-end proof runs in the dev-stand-gated Playwright suite; this tier
 * proves the client guard logic without a stand, so it runs in the `@ds/portal`
 * vitest lane.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const session = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    session: () => session(),
  },
}));

beforeEach(() => {
  replace.mockClear();
  session.mockReset();
});
afterEach(cleanup);

describe("#675 AuthShell auth-surface guard", () => {
  it("redirects an authenticated visitor to /account and renders no auth form", async () => {
    session.mockResolvedValue({ sub: "u1", roles: ["doctor_guest"], mfa: false });

    render(
      <AuthShell>
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
    // The AC: NO auth form is ever rendered for the authed visitor.
    expect(screen.queryByTestId("auth-form")).not.toBeInTheDocument();
  });

  it("renders the shell + child for an anonymous visitor and never redirects", async () => {
    session.mockResolvedValue(null);

    render(
      <AuthShell>
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    // The guarded child appears only once the session check resolves to null.
    expect(await screen.findByTestId("auth-form")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("EARS-28: allowAuthenticated (the /reset exemption) renders the form for an AUTHENTICATED visitor and never redirects", async () => {
    // Even with a live session, the exempted surface renders immediately — the
    // /account «Сменить пароль» handoff must not dead-end back to /account.
    session.mockResolvedValue({ sub: "u1", roles: ["doctor_guest"], mfa: false });

    render(
      <AuthShell allowAuthenticated>
        <div data-testid="auth-form">form</div>
      </AuthShell>,
    );

    expect(await screen.findByTestId("auth-form")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    // Guard disabled ⇒ no session read is even issued for the exempted surface.
    expect(session).not.toHaveBeenCalled();
  });
});

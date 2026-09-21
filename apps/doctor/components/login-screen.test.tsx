import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { LoginScreen } from "@/components/login-screen";

/**
 * #1933 — what reaches the HTML of the doctor sign-in screen.
 *
 * Static server markup, not jsdom, for the reason `vitest.config.ts` states: the
 * doctor unit tier is node-only. The shared sign-in door itself — the card, the
 * footer links, the published landing decision, submit/OTP behaviour — is owned
 * and tested by `@ds/auth-flow/login` (`packages/auth-flow/src/login/*.test.tsx`).
 * What stays HERE is the host-only projection: the return-context slot this host
 * fills. The BEHAVIOUR of the surface in a real browser is driven by
 * `e2e/login.spec.ts`, which is where a sign-in defect actually shows.
 */
function render(props?: Partial<Parameters<typeof LoginScreen>[0]>) {
  return renderToStaticMarkup(
    <LoginScreen
      registerHref="/register"
      resetHref="/reset"
      landing="/"
      {...props}
    />,
  );
}

describe("017 #1933: the doctor sign-in screen", () => {
  it("017 #1933.13: with no return context NOTHING stands in for it (honest-empty)", () => {
    expect(render()).not.toContain("login-return-context");
    expect(render({ returnContext: <p>эфир</p> })).toContain(
      "login-return-context",
    );
  });
});

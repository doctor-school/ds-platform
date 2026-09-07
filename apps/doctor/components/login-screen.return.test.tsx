// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 005 EARS-2 on doctor.school (#2005) — a doctor who signed in carrying an эфир
 * intent is REGISTERED to that эфир and lands on it.
 *
 * The defect this tier exists to catch: before #2005 `finishLogin()` pushed the
 * server landing and fired nothing, so a doctor who pressed «Участвовать» on a
 * gated эфир, signed in, and arrived back on `/events/<slug>` was still asked to
 * register — the Academy has completed the intent since 005 shipped
 * (`apps/portal/app/login/page.tsx`), and this host did not.
 *
 * What is asserted is the ORDER of two effects — the `RegisterForEvent` command
 * and the navigation — which no static-markup render can observe, so this file
 * opens jsdom the way `registration-screen.test.tsx` and `account-screen.test.tsx`
 * do rather than joining the node-tier `login-screen.test.tsx` next to it.
 *
 * `@ds/events-storefront/client` is the mocked seam, not the barrel: the package's
 * own `completeReturnTarget` imports `registerForEvent` from that entry, so
 * mocking the barrel would leave the intra-package import untouched and the
 * command unobserved (slice-1 finding). The RULE under the mock is the real one —
 * the shared `completeReturnTarget` with this host's `doctorReturnHost` config.
 */
const registerForEvent = vi.fn();
vi.mock("@ds/events-storefront/client", () => ({
  registerForEvent: (slug: string) => registerForEvent(slug),
  RegistrationError: class extends Error {},
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const login = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    login: (...args: unknown[]) => login(...args),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
  },
}));

import { LoginScreen } from "@/components/login-screen";

beforeEach(() => {
  registerForEvent.mockReset().mockResolvedValue(undefined);
  push.mockReset();
  refresh.mockReset();
  login.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

async function signIn(props?: Partial<Parameters<typeof LoginScreen>[0]>) {
  const user = userEvent.setup();
  render(
    <LoginScreen registerHref="/register" landing="/events" {...props} />,
  );
  await user.type(screen.getByLabelText("Почта или телефон"), "doc@clinic.ru");
  await user.type(screen.getByLabelText("Пароль"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "Войти" }));
  await waitFor(() => expect(login).toHaveBeenCalled());
}

describe("005 EARS-2: the doctor sign-in completes the carried эфир intent", () => {
  it("005 EARS-2: an эфир intent fires RegisterForEvent for its slug and lands on this host's event page", async () => {
    await signIn({ returnTarget: "/events/cardio-live" });

    await waitFor(() =>
      expect(registerForEvent).toHaveBeenCalledWith("cardio-live"),
    );
    expect(push).toHaveBeenCalledWith("/events/cardio-live");
    expect(refresh).toHaveBeenCalled();
  });

  it("005 EARS-2: a direct arrival carries no intent — the server landing stands and NO registration fires", async () => {
    await signIn();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it("005 EARS-2: an unsafe target is honoured by nothing — the landing stands and NO registration fires", async () => {
    // Defence in depth. The route hands over a value its own guard already
    // reconstructed (`lib/return-context.ts`), so a cross-origin string cannot
    // reach here through the shipped path; the shared rule still refuses it, so
    // the one branch that returns a carried value verbatim can never become an
    // open redirect if a future caller wires the screen without resolving first.
    await signIn({ returnTarget: "https://evil.example/events/cardio-live" });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events"));
    expect(registerForEvent).not.toHaveBeenCalled();
  });
});

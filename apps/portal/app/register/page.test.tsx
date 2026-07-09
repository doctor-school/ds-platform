import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RegisterPage from "./page";

/**
 * #337 (submit/pending progress visualization): on form submit the surface must read
 * as "working", not a static disabled button that looks hung (the owner finding from
 * the #333 Stage-B review). The standard is the shared `Button.loading` affordance —
 * spinner + `aria-busy` + disabled-while-loading — driven from the form's
 * `isSubmitting`, NOT a bare `disabled={isSubmitting}` (which gives no progress signal).
 *
 * This test holds the registration request in flight (a deferred promise) and asserts
 * the submit button carries `aria-busy` + the spinner while the network call is
 * pending — the contract the old `disabled`-only wiring failed.
 */

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}));

// Passthrough i18n: return the key (the test asserts on stable testids, not copy).
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Deferred so the submit stays in-flight while we assert the pending affordance.
let resolveRegister: (() => void) | undefined;
const register = vi.fn(
  (_body: unknown) =>
    new Promise<void>((resolve) => {
      resolveRegister = resolve;
    }),
);
// #675: rendering the page mounts the <AuthShell> auth-surface guard, which reads
// `authClient.session()` on mount — default it to the unauthenticated path so the
// form renders as before (the authed branch lives in components/auth-shell.test.tsx).
const session = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    register: (body: unknown) => register(body),
    session: () => session(),
  },
  AuthError: class extends Error {},
}));

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

/**
 * Render /register and wait past the #675 <AuthShell> session-guard. The guard
 * renders nothing until `session()` resolves (to `null` here → the anonymous path),
 * so the form appears asynchronously; gate on the submit before interacting.
 */
async function renderRegister() {
  render(<RegisterPage />);
  await screen.findByTestId("register-submit");
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  register.mockClear();
  resolveRegister = undefined;
  searchParams = new URLSearchParams();
});
afterEach(() => {
  // Drain any still-pending submit so it does not leak across tests.
  resolveRegister?.();
  cleanup();
});

describe("/register submit pending affordance (#337)", () => {
  it("shows the spinner + aria-busy on the submit while the register request is in flight", async () => {
    const user = userEvent.setup();
    await renderRegister();

    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);

    const submit = screen.getByTestId("register-submit");
    // Idle: no busy state, no spinner.
    expect(submit).not.toHaveAttribute("aria-busy");

    await user.click(submit);

    // In flight: the standard pending affordance is shown.
    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(1);
      expect(submit).toHaveAttribute("aria-busy", "true");
    });
    expect(submit.querySelector("svg.animate-spin")).not.toBeNull();
  });
});

/**
 * 005 EARS-2 — the /register hop of the guest-through-auth round-trip: a guest
 * who entered the 003 flow from an event's «Участвовать» CTA arrives here with
 * `?returnTo=/webinars/:slug` (004 EARS-3 handoff). The event context must
 * survive BOTH onward hops this page owns — the post-submit `/verify`
 * navigation and the «уже есть аккаунт» `/login` link — while a hostile
 * (cross-origin / open-redirect) value is dropped at the hop, never propagated.
 */
describe("005 EARS-2 event-context carry through /register", () => {
  async function submitRegistration() {
    const user = userEvent.setup();
    await renderRegister();
    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("register-submit"));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    resolveRegister?.();
  }

  it("EARS-2: the system shall carry a safe event returnTo onward into the /verify navigation", async () => {
    searchParams = new URLSearchParams({ returnTo: "/webinars/ahilles-042" });
    await submitRegistration();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/verify?email=${encodeURIComponent(EMAIL)}&returnTo=%2Fwebinars%2Fahilles-042`,
      ),
    );
  });

  it("EARS-2: a cross-origin / open-redirect returnTo shall be dropped from the /verify navigation", async () => {
    searchParams = new URLSearchParams({ returnTo: "//evil.example" });
    await submitRegistration();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/verify?email=${encodeURIComponent(EMAIL)}`,
      ),
    );
  });

  it("EARS-2: the «already have an account» link carries the event context onward into /login", async () => {
    searchParams = new URLSearchParams({ returnTo: "/webinars/ahilles-042" });
    await renderRegister();

    expect(screen.getByRole("link", { name: "haveAccount" })).toHaveAttribute(
      "href",
      "/login?returnTo=%2Fwebinars%2Fahilles-042",
    );
  });
});

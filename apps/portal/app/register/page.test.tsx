import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@ds/auth-flow/client";

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

type CaptchaProps = {
  requestKey: number | null;
  onToken: (token?: string) => void;
  onError: (reason: "expired" | "unavailable" | "incomplete") => void;
};
let captchaMode: "bypass" | "manual" = "bypass";
let captchaProps: CaptchaProps | undefined;
vi.mock("@ds/design-system/blocks", async () => {
  const React = await import("react");
  const actual = await vi.importActual<
    typeof import("@ds/design-system/blocks")
  >("@ds/design-system/blocks");
  return {
    ...actual,
    BotProtectionField: (props: CaptchaProps) => {
      captchaProps = props;
      React.useEffect(() => {
        if (captchaMode === "bypass" && props.requestKey !== null) {
          props.onToken(undefined);
        }
      }, [props.onToken, props.requestKey]);
      return <div data-testid="bot-protection-field" />;
    },
  };
});

// Deferred so the submit stays in-flight while we assert the pending affordance.
let resolveRegister: (() => void) | undefined;
const register = vi.fn(
  (_body: unknown, _captchaToken?: string) =>
    new Promise<void>((resolve) => {
      resolveRegister = resolve;
    }),
);
/**
 * #675 is NOT decided on this surface. The signed-in guard runs SERVER-side in
 * `app/register/layout.tsx` (`guardAuthRoute` from `@ds/auth-flow/server`), before
 * any of this renders — pinned by `app/auth-route-guard.test.tsx` and
 * `packages/auth-flow/src/server/auth-route-guard.test.ts`. The frame around the
 * card is the shared `<AuthShell>` of `@ds/auth-flow/shell`, covered by
 * `packages/auth-flow/src/shell/auth-shell.test.tsx`.
 */
vi.mock("@/lib/auth-flow-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth-flow-client")>()),
  authClient: {
    register: (body: unknown, captchaToken?: string) =>
      register(body, captchaToken),
  },
}));

const EMAIL = "doc@example.com";
const PASSWORD = "Sup3r$ecretPw!9";

/**
 * Render /register and gate on the submit before interacting — the card mounts its
 * client boundary and its challenge field asynchronously.
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
  captchaMode = "bypass";
  captchaProps = undefined;
});

describe("003 EARS-17 on-demand registration protection", () => {
  it("EARS-17: submit executes a fresh invisible challenge and resumes registration exactly once with its token", async () => {
    captchaMode = "manual";
    register.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderRegister();
    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);

    await user.click(screen.getByTestId("register-submit"));
    expect(register).not.toHaveBeenCalled();
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());

    act(() => captchaProps?.onToken("fresh-register-token"));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    // Row 18: body without the token, token as the header-bound second argument.
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL }),
      "fresh-register-token",
    );

    act(() => captchaProps?.onToken("fresh-register-token"));
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("EARS-17: a rejected token gets truthful CAPTCHA feedback and a fresh retry without losing form data", async () => {
    captchaMode = "manual";
    register.mockRejectedValueOnce(
      new AuthError(403, "bot protection failed", "BOT_PROTECTION_REJECTED"),
    );
    const user = userEvent.setup();
    await renderRegister();
    await user.type(screen.getByLabelText("email"), EMAIL);
    await user.type(screen.getByLabelText("password"), PASSWORD);
    await user.click(screen.getByTestId("register-submit"));

    act(() => captchaProps?.onToken("rejected-token"));
    await waitFor(() =>
      expect(screen.getByText("captchaRejected")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("email")).toHaveValue(EMAIL);
    expect(screen.getByLabelText("password")).toHaveValue(PASSWORD);
    await waitFor(() => expect(captchaProps?.requestKey).toBeNull());

    register.mockResolvedValueOnce(undefined);
    await user.click(screen.getByTestId("register-submit"));
    await waitFor(() => expect(captchaProps?.requestKey).not.toBeNull());
    act(() => captchaProps?.onToken("fresh-retry-token"));
    await waitFor(() =>
      expect(screen.queryByText("captchaRejected")).not.toBeInTheDocument(),
    );
  });
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

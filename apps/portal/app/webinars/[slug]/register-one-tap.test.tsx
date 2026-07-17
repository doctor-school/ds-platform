import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1111 (005 EARS-1) — the logged-in «Участвовать» one-tap CTA must survive weak
 * networks: it is rendered as a REAL `<form>` whose action is a server action, so
 * it works before hydration (a slow/failed JS bundle no longer leaves a dead
 * button). Once hydrated, the SAME control keeps today's one-tap path: intercept
 * the submit, POST `RegisterForEvent` client-side, and re-read the per-user state
 * in place (`router.refresh()`) with NO navigation. Repeats are server-side
 * idempotent (EARS-3); copy stays catalog-sourced via props (EARS-12).
 *
 * jsdom always has JS on, so these tests cover the hydrated path + the structural
 * no-JS contract (real form, submit button, slug payload carrier). The actual
 * no-JS server-action execution is verified live (Playwright / lead live-verify).
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { registerForEvent } = vi.hoisted(() => ({ registerForEvent: vi.fn() }));
vi.mock("@/lib/registration-client", () => ({
  registerForEvent: (slug: string) => registerForEvent(slug),
}));

// The server action module imports next/headers + redirect (server-only) — mock
// it so the client component under test can import it in jsdom, and so we can
// assert the hydrated path does NOT fall through to it (preventDefault worked).
const { registerForEventAction } = vi.hoisted(() => ({
  registerForEventAction: vi.fn(),
}));
vi.mock("./register-action", () => ({
  registerForEventAction: (formData: FormData) =>
    registerForEventAction(formData),
}));

import { RegisterOneTap } from "./register-one-tap";

const SLUG = "ahilles-042";

beforeEach(() => {
  refresh.mockClear();
  registerForEvent.mockReset();
  registerForEventAction.mockClear();
});
afterEach(() => cleanup());

describe("#1111 RegisterOneTap progressive enhancement (005 EARS-1)", () => {
  it("EARS-1: renders a REAL form with a submit button and the slug payload — works before hydration", () => {
    const { container } = render(
      <RegisterOneTap slug={SLUG} label="Участвовать" errorLabel="err" />,
    );
    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    const submit = screen.getByTestId("event-register-one-tap");
    expect(submit).toHaveAttribute("type", "submit");
    expect(form).toContainElement(submit);

    // The no-JS native POST carries the slug the server action reads.
    const slugInput = container.querySelector('input[name="slug"]');
    expect(slugInput).toHaveValue(SLUG);
  });

  it("EARS-1: when hydrated, submitting fires the client one-tap POST + in-place refresh, with NO navigation", async () => {
    registerForEvent.mockResolvedValue({ registered: true });
    const { container } = render(
      <RegisterOneTap slug={SLUG} label="Участвовать" errorLabel="Ошибка" />,
    );

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(registerForEvent).toHaveBeenCalledWith(SLUG));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // The submit was intercepted (preventDefault) — the server-action fall-through
    // never fired, so there is no navigation.
    expect(registerForEventAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("EARS-3: a registration failure (401/409/transient) surfaces the retryable FormError, no refresh", async () => {
    registerForEvent.mockRejectedValue(new Error("registration failed (401)"));
    const { container } = render(
      <RegisterOneTap
        slug={SLUG}
        label="Участвовать"
        errorLabel="Не удалось записать — попробуйте ещё раз"
      />,
    );

    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Не удалось записать — попробуйте ещё раз",
      ),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

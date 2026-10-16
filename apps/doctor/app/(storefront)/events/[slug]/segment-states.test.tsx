// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { default: ErrorBoundary } = await import("./error");
const { default: Loading } = await import("./loading");

describe("020 EARS-19 (gate rows 28–29, D8): this host's event-page segment states", () => {
  it("a failing read renders the canvas error with «Повторить», and the retry re-renders on success", () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={new Error("read failed")} reset={reset} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Не получилось загрузить событие",
    );
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("the route segment's loading state is the canvas skeleton", () => {
    render(<Loading />);
    expect(
      screen.getByTestId("event-page-skeleton").getAttribute("aria-busy"),
    ).toBe("true");
  });
});

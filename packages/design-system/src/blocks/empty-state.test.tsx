import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";

afterEach(cleanup);

/**
 * `<EmptyState>` (#1578). The contract under test is that the two empty situations
 * are two DISTINCT variants — the collapsed single `emptyLabel` string of the
 * hand-composed `AdminListShell` is the defect this block closes.
 */
describe("<EmptyState>", () => {
  it("renders the no-records variant with its own copy and primary action", () => {
    render(
      <EmptyState
        variant="no-records"
        title="Направлений пока нет"
        description="Создайте первое направление, чтобы начать наполнять справочник."
        action={<button type="button">Создать направление</button>}
      />,
    );
    expect(screen.getByText("Направлений пока нет")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать направление" }),
    ).toBeInTheDocument();
  });

  it("renders the no-results variant with the applied query named and a way out", () => {
    render(
      <EmptyState
        variant="no-results"
        title="Ничего не найдено"
        description={'По запросу «ревмато» со статусом «Черновик» ничего не найдено'}
        action={<button type="button">Сбросить фильтры</button>}
      />,
    );
    expect(
      screen.getByText(
        "По запросу «ревмато» со статусом «Черновик» ничего не найдено",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Сбросить фильтры" }),
    ).toBeInTheDocument();
  });

  it("carries the variant as a machine-readable marker, so the two never collapse", () => {
    const { container, rerender } = render(
      <EmptyState variant="no-records" title="Пусто" />,
    );
    expect(container.firstChild).toHaveAttribute("data-variant", "no-records");
    rerender(<EmptyState variant="no-results" title="Пусто" />);
    expect(container.firstChild).toHaveAttribute("data-variant", "no-results");
  });

  it("omits the description and action slots when they are not supplied", () => {
    render(<EmptyState variant="no-records" title="Пусто" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Пусто")).toBeInTheDocument();
  });
});

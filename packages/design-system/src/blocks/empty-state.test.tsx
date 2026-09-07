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

/**
 * 028 (#1966) — the three NON-EMPTY absences a document surface shows. They are
 * separate variants because the reader's next move differs: wait, retry, leave.
 */
describe("<EmptyState> — 028 document states", () => {
  it("028 EARS-7: the loading variant announces the wait without showing a message that later flips to content", () => {
    render(<EmptyState variant="loading" title="Документ загружается" />);

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    // The copy exists for assistive tech only.
    expect(screen.getByText("Документ загружается")).toHaveClass("sr-only");
  });

  it("028 EARS-7: the loading skeleton bars are painted on the hairline tier, so the wait is VISIBLE and not a blank page", () => {
    const { container } = render(
      <EmptyState variant="loading" title="Документ загружается" />,
    );

    const bars = container.querySelectorAll('span[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      // `bg-muted` is ~1.00 contrast against `bg-section`/`bg-background`; the
      // canvas paints these bars one tier darker (`hairline`).
      expect(bar).toHaveClass("bg-hairline");
      expect(bar).not.toHaveClass("bg-muted");
    }
  });

  it("028 EARS-7: the error variant is an alert with a retry, not an emptiness", () => {
    render(
      <EmptyState
        variant="error"
        title="Не удалось загрузить документ."
        action={<button type="button">Повторить</button>}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("border-destructive", "bg-destructive-tint");
    expect(
      screen.getByRole("button", { name: "Повторить" }),
    ).toBeInTheDocument();
  });

  it("028 EARS-7: the not-found variant offers the way out and never a retry", () => {
    render(
      <EmptyState
        variant="not-found"
        title="Такого документа нет."
        description="Возможно, ссылка устарела."
        action={<a href="/documents">Все документы платформы →</a>}
      />,
    );

    expect(screen.getByText("Такого документа нет.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Все документы платформы →" }),
    ).toHaveAttribute("href", "/documents");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("028 EARS-7: the not-found variant omits its own headline when the host surface already prints it", () => {
    render(
      <EmptyState
        variant="not-found"
        description="Возможно, ссылка устарела."
        action={<a href="/documents">Все документы платформы →</a>}
      />,
    );

    expect(screen.getByText("Возможно, ссылка устарела.")).toBeInTheDocument();
    expect(screen.queryByText("Такого документа нет.")).toBeNull();
  });

  it("028 EARS-7: the two original empty variants are untouched by the extension", () => {
    render(<EmptyState variant="no-records" title="Направлений пока нет" />);

    const node = screen.getByText("Направлений пока нет").parentElement;
    expect(node).toHaveAttribute("data-variant", "no-records");
    expect(node?.className).toContain("text-center");
  });
});

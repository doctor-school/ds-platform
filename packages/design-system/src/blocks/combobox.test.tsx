import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Combobox, type ComboboxOption } from "./combobox";

// Radix's focus-scope schedules a restore-focus timer while the panel is open, so a
// test that ends with the panel still open trips the #441 orphan-timer guard. Close
// it the way an operator would (Escape) before unmounting.
afterEach(async () => {
  const trigger = screen.queryByRole("combobox");
  if (trigger?.getAttribute("aria-expanded") === "true") {
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "false"),
    );
  }
});
afterEach(cleanup);

/**
 * `<Combobox>` (#1578, adopted from Kibo UI, MIT). jsdom lacks the two browser APIs
 * the Radix popper and `cmdk` need — a `ResizeObserver` and `scrollIntoView` — so the
 * harness supplies them; everything else under test is the component's own contract.
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= vi.fn();
});

/** «Вид связи» — five options, none self-evident: the EXPLANATION trigger. */
const KINDS: ComboboxOption[] = [
  {
    value: "adjacent_area",
    label: "Смежная область",
    description: "Направления пересекаются, но ни одно не входит в другое",
  },
  {
    value: "narrower",
    label: "Более узкое направление",
    description: "Частный случай выбранного направления",
  },
  {
    value: "broader",
    label: "Более широкое направление",
    description: "Выбранное направление входит в это",
  },
  {
    value: "diagnostic_support",
    label: "Диагностическая поддержка",
    description: "Помогает ставить диагноз в выбранном направлении",
  },
  {
    value: "shared_disease_group",
    label: "Общая группа заболеваний",
    description: "Работают с одной группой заболеваний",
  },
];

describe("<Combobox>", () => {
  it("carries the ARIA combobox contract on the closed control", () => {
    render(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");
    expect(trigger).toHaveTextContent("Выберите вид связи");
  });

  it("renders the chosen option's LABEL, never its stored slug", () => {
    render(
      <Combobox
        options={KINDS}
        value="diagnostic_support"
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Диагностическая поддержка");
    expect(trigger.textContent).not.toContain("diagnostic_support");
  });

  it("opens the owned panel and shows a per-option explanation line", async () => {
    render(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByRole("combobox")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(screen.getByText("Более узкое направление")).toBeInTheDocument();
    expect(
      screen.getByText("Частный случай выбранного направления"),
    ).toBeInTheDocument();
  });

  it("commits the option's VALUE while never rendering a slug (closed vocabulary)", async () => {
    const onValueChange = vi.fn();
    render(
      <Combobox
        options={KINDS}
        onValueChange={onValueChange}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("Смежная область")).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByText("Смежная область"));
    expect(onValueChange).toHaveBeenCalledWith("adjacent_area");
  });

  it("hides the in-panel query box for a short explained vocabulary", async () => {
    render(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        searchLabel="Поиск"
        emptyLabel="Ничего не найдено"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("Смежная область")).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Поиск")).not.toBeInTheDocument();
  });

  it("shows the query box for a long book and reports the no-match state", async () => {
    const book: ComboboxOption[] = Array.from({ length: 20 }, (_, index) => ({
      value: `spec-${index}`,
      label: `Специальность ${index}`,
    }));
    render(
      <Combobox
        options={book}
        onValueChange={vi.fn()}
        placeholder="Выберите специальность"
        searchLabel="Поиск по справочнику"
        emptyLabel="Ничего не найдено"
        countLabel={(shown, total) => `Найдено ${shown} из ${total}`}
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    const query = await screen.findByLabelText("Поиск по справочнику");
    expect(screen.getByText("Найдено 20 из 20")).toBeInTheDocument();

    await userEvent.type(query, "ревмато");
    await waitFor(() =>
      expect(screen.getByText("Ничего не найдено")).toBeInTheDocument(),
    );
    expect(screen.getByText("Найдено 0 из 20")).toBeInTheDocument();
  });

  it("never lets typing enter free text into the value", async () => {
    const onValueChange = vi.fn();
    const book: ComboboxOption[] = Array.from({ length: 20 }, (_, index) => ({
      value: `spec-${index}`,
      label: `Специальность ${index}`,
    }));
    render(
      <Combobox
        options={book}
        onValueChange={onValueChange}
        placeholder="Выберите специальность"
        searchLabel="Поиск по справочнику"
        emptyLabel="Ничего не найдено"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    const query = await screen.findByLabelText("Поиск по справочнику");
    await userEvent.type(query, "новая специальность{Enter}");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("carries invalidity and disabled on the control itself", () => {
    const { rerender } = render(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
        invalid
      />,
    );
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
    rerender(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
        disabled
      />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

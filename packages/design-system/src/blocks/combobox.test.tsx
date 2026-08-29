import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Combobox, type ComboboxOption } from "./combobox";

afterEach(cleanup);

/**
 * Close the open panel and wait for the unmount to settle.
 *
 * Not cosmetic: Radix's focus-scope restores focus to the trigger from an unmount
 * `setTimeout` it schedules with no cleanup, so a test that ends with the panel
 * still mounted leaves that timer to fire after JSDOM teardown — exactly the class
 * the #441 orphan-timer guard fails the suite on. `aria-expanded` flips a tick
 * before the portal actually leaves the tree, so the wait is on the panel element
 * itself (Radix's popover content carries `role="dialog"`), which is what lets the
 * restore run while the environment is still alive — the same shape
 * `dialog.test.tsx` uses for the modal primitives.
 */
async function dismiss(): Promise<void> {
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
}

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

  /**
   * `role="combobox"` forbids name-from-content, so the visible label contributes
   * NOTHING to the accessible name — the axe `button-name` critical this suite let
   * through while asserting `toHaveTextContent`. The block owns the name so no call
   * site can instantiate a nameless combobox.
   */
  it("names the closed control for assistive tech, empty and selected", () => {
    const { rerender } = render(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "Выберите вид связи",
    );

    rerender(
      <Combobox
        options={KINDS}
        value="broader"
        onValueChange={vi.fn()}
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    // Field name first, then the chosen value — «Выберите вид связи, Более широкое направление».
    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "Выберите вид связи Более широкое направление",
    );
  });

  it("prefers an explicit aria-label over the placeholder as the field name", () => {
    render(
      <Combobox
        options={KINDS}
        onValueChange={vi.fn()}
        aria-label="Вид связи"
        placeholder="Выберите вид связи"
        emptyLabel="Ничего не найдено"
      />,
    );
    expect(screen.getByRole("combobox")).toHaveAccessibleName("Вид связи");
  });

  it("defers to an external aria-labelledby (a `Label` wired by `FormControl`)", () => {
    render(
      <>
        <span id="kind-label">Вид связи</span>
        <Combobox
          options={KINDS}
          value="broader"
          onValueChange={vi.fn()}
          aria-labelledby="kind-label"
          placeholder="Выберите вид связи"
          emptyLabel="Ничего не найдено"
        />
      </>,
    );
    expect(screen.getByRole("combobox")).toHaveAccessibleName(
      "Вид связи Более широкое направление",
    );
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
    await dismiss();
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
    await dismiss();
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
    await dismiss();
  });

  it("delegates filtering to a remote option source when search is controlled by the app", async () => {
    const onSearchChange = vi.fn();
    render(
      <Combobox
        options={[{ value: "user-1", label: "Иван Петров" }]}
        onValueChange={vi.fn()}
        onSearchChange={onSearchChange}
        placeholder="Выберите пользователя"
        searchLabel="Поиск пользователя"
        emptyLabel="Ничего не найдено"
        showSearch
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    const query = await screen.findByLabelText("Поиск пользователя");
    await userEvent.type(query, "Сидоров");

    expect(onSearchChange).toHaveBeenLastCalledWith("Сидоров");
    // The returned server page remains visible even when its label does not
    // contain the query; cmdk must not apply a second, local filter.
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
    await dismiss();
  });

  it("loads the next remote page only on an explicit, duplicate-safe operator action", async () => {
    let resolveLoad: (() => void) | undefined;
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    render(
      <Combobox
        options={[{ value: "user-1", label: "Иван Петров" }]}
        onValueChange={vi.fn()}
        onSearchChange={vi.fn()}
        onLoadMore={onLoadMore}
        hasMore
        loadMoreLabel="Загрузить ещё"
        loadingMoreLabel="Загружаем пользователей"
        placeholder="Выберите пользователя"
        searchLabel="Поиск пользователя"
        emptyLabel="Ничего не найдено"
        showSearch
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));
    const loadMore = await screen.findByRole("button", {
      name: "Загрузить ещё",
    });

    expect(onLoadMore).not.toHaveBeenCalled();
    await userEvent.dblClick(loadMore);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(loadMore).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Загружаем пользователей",
    );

    resolveLoad?.();
    await waitFor(() => expect(loadMore).toBeEnabled());
    await dismiss();
  });

  it("keeps loaded options available and exposes an accessible retry after a page error", async () => {
    const onLoadMore = vi.fn();
    render(
      <Combobox
        options={[{ value: "user-1", label: "Иван Петров" }]}
        value="user-1"
        onValueChange={vi.fn()}
        onLoadMore={onLoadMore}
        hasMore
        loadMoreError
        loadMoreLabel="Загрузить ещё"
        loadMoreErrorLabel="Не удалось загрузить. Повторить"
        placeholder="Выберите пользователя"
        emptyLabel="Ничего не найдено"
      />,
    );
    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getAllByText("Иван Петров")).toHaveLength(2);
    const retry = screen.getByRole("button", {
      name: "Не удалось загрузить. Повторить",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Не удалось загрузить. Повторить",
    );
    await userEvent.click(retry);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    await dismiss();
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
    await dismiss();
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
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
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

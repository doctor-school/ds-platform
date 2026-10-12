import type * as React from "react";
import {
  render,
  screen,
  cleanup,
  act,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterBar, FilterBarTextField } from "./filter-bar";

afterEach(cleanup);

/**
 * `<FilterBar>` (#1578). The pair of apply-model tests is what makes the MIXED model
 * (one control queued behind «Применить» while its neighbours fire on change — the
 * Stage-B rejection) unbuildable rather than merely discouraged: in `instant` no
 * submit control exists and the text field commits itself after the debounce window;
 * in `batch` nothing commits before submit.
 */
function renderBar(props: Partial<React.ComponentProps<typeof FilterBar>> = {}) {
  return render(
    <FilterBar
      applyMode="instant"
      label="Фильтры списка"
      resetLabel="Сбросить всё"
      search={{
        value: "",
        onCommit: vi.fn(),
        label: "Поиск по названию",
        placeholder: "Например, кардиология",
      }}
      {...props}
    />,
  );
}

describe("<FilterBar>", () => {
  describe('applyMode="instant"', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders NO submit control — every control is its own trigger", () => {
      renderBar();
      expect(
        screen.queryByRole("button", { name: "Применить" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Применить/ }),
      ).not.toBeInTheDocument();
    });

    it("commits the text query once, after the inactivity window — never per keystroke", async () => {
      const onCommit = vi.fn();
      renderBar({
        search: {
          value: "",
          onCommit,
          label: "Поиск по названию",
          debounceMs: 400,
        },
      });
      const field = screen.getByLabelText("Поиск по названию");
      // Five keystrokes inside the window must produce ONE commit, not five —
      // `fireEvent` (not `userEvent`) because the assertion is about the timer.
      for (const value of ["к", "ка", "кар", "кард", "карди"]) {
        fireEvent.change(field, { target: { value } });
        act(() => {
          vi.advanceTimersByTime(100);
        });
      }
      expect(onCommit).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith("карди");
    });

    it("carries the busy cue for its OWN debounce window — the promise does not depend on the caller driving isBusy", () => {
      renderBar({
        busyLabel: "Идёт поиск",
        search: {
          value: "",
          onCommit: vi.fn(),
          label: "Поиск по названию",
          debounceMs: 400,
        },
      });
      const field = screen.getByLabelText("Поиск по названию");
      expect(field).not.toHaveAttribute("aria-busy");

      fireEvent.change(field, { target: { value: "карди" } });
      expect(field).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Идёт поиск")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(field).not.toHaveAttribute("aria-busy");
    });

    it("NEVER overwrites in-flight typing when the parent's committed value lands late", () => {
      // The data-loss race: the commit fires 400ms after a pause, the parent's
      // state/URL round trip re-renders the bar with that value, and by then the
      // operator is already typing the next word. An unconditional resync from
      // `search.value` deletes those characters under the cursor.
      const onCommit = vi.fn();
      const { rerender } = renderBar({
        search: { value: "", onCommit, label: "Поиск по названию", debounceMs: 400 },
      });
      const field = screen.getByLabelText("Поиск по названию");

      fireEvent.change(field, { target: { value: "карди" } });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onCommit).toHaveBeenCalledWith("карди");

      // The operator keeps typing while the parent is still round-tripping.
      fireEvent.change(field, { target: { value: "кардиоло" } });

      // …and the commit echo arrives.
      rerender(
        <FilterBar
          applyMode="instant"
          label="Фильтры списка"
          resetLabel="Сбросить всё"
          search={{ value: "карди", onCommit, label: "Поиск по названию", debounceMs: 400 }}
        />,
      );
      expect(field).toHaveValue("кардиоло");
    });

    it("fires the LATEST onCommit, so a facet toggled inside the debounce window is not rolled back", () => {
      // The operator types a search and — inside the 400ms window — flips a
      // facet beside it. The parent rebuilds `onCommit` around its NEW query on
      // that re-render; a timer holding the keystroke-time callback would commit
      // the PRE-toggle query and silently undo the facet the operator just set.
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderBar({
        search: { value: "", onCommit: first, label: "Поиск по названию", debounceMs: 400 },
      });
      const field = screen.getByLabelText("Поиск по названию");

      fireEvent.change(field, { target: { value: "карди" } });
      // The facet flips before the window closes: same value, fresh callback.
      rerender(
        <FilterBar
          applyMode="instant"
          label="Фильтры списка"
          resetLabel="Сбросить всё"
          search={{ value: "", onCommit: second, label: "Поиск по названию", debounceMs: 400 }}
        />,
      );
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(second).toHaveBeenCalledWith("карди");
      expect(first).not.toHaveBeenCalled();
    });

    it("still follows an EXTERNAL value change (reset-all, a restored URL)", () => {
      const onCommit = vi.fn();
      const { rerender } = renderBar({
        search: { value: "", onCommit, label: "Поиск по названию" },
      });
      const field = screen.getByLabelText("Поиск по названию");
      fireEvent.change(field, { target: { value: "черновик" } });

      rerender(
        <FilterBar
          applyMode="instant"
          label="Фильтры списка"
          resetLabel="Сбросить всё"
          search={{ value: "кардио", onCommit, label: "Поиск по названию" }}
        />,
      );
      expect(field).toHaveValue("кардио");
    });
  });

  describe('applyMode="batch"', () => {
    it("renders the submit control and commits nothing before it is pressed", async () => {
      const onCommit = vi.fn();
      const onSubmit = vi.fn();
      renderBar({
        applyMode: "batch",
        submitLabel: "Применить",
        onSubmit,
        search: { value: "", onCommit, label: "Поиск по названию" },
      });
      await userEvent.type(
        screen.getByLabelText("Поиск по названию"),
        "карди",
      );
      expect(onCommit).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Применить" }));
      expect(onCommit).toHaveBeenCalledWith("карди");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the reset control only while something is applied", () => {
    const { rerender } = renderBar({ onResetAll: vi.fn() });
    expect(
      screen.queryByRole("button", { name: "Сбросить всё" }),
    ).not.toBeInTheDocument();

    rerender(
      <FilterBar
        applyMode="instant"
        label="Фильтры списка"
        resetLabel="Сбросить всё"
        onResetAll={vi.fn()}
        applied={[{ id: "status", label: "Статус: Черновик", onRemove: vi.fn() }]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Сбросить всё" }),
    ).toBeInTheDocument();
  });

  it("renders every applied filter as its OWN removable unit, not a bare count", async () => {
    const onRemove = vi.fn();
    renderBar({
      appliedLabel: "Выбрано:",
      applied: [
        { id: "status", label: "Статус: Черновик", onRemove },
        { id: "retired", label: "Показывать снятые", onRemove: vi.fn() },
      ],
    });
    expect(screen.getByText("Выбрано:")).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Статус: Черновик" });
    await userEvent.click(chip);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Показывать снятые" })).toBeInTheDocument();
  });

  it("names each chip VERB-FIRST so the control says it removes the filter", () => {
    renderBar({
      removeFilterLabel: "Убрать фильтр",
      applied: [{ id: "status", label: "Черновики", onRemove: vi.fn() }],
    });
    // The visible ✕ lives inside the chip's own text node, so name-from-content
    // announces the bare value — the operator hears WHAT, never WHAT HAPPENS.
    expect(
      screen.getByRole("button", { name: "Убрать фильтр: Черновики" }),
    ).toBeInTheDocument();
  });

  it("announces the result count in a live region", () => {
    renderBar({ resultCount: "найдено 12 из 214" });
    const line = screen.getByText("найдено 12 из 214");
    expect(line).toHaveAttribute("aria-live", "polite");
  });

  it("carries the busy cue on the field, never a frozen list", () => {
    renderBar({ isBusy: true, busyLabel: "Идёт поиск" });
    expect(screen.getByLabelText("Поиск по названию")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Идёт поиск")).toBeInTheDocument();
  });

  it("exposes the bar as a named region and hosts app facet controls", () => {
    renderBar({ children: <button type="button">Состояние</button> });
    expect(
      screen.getByRole("region", { name: "Фильтры списка" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Состояние" }),
    ).toBeInTheDocument();
  });
  describe("moreFilters — the opt-in «Все фильтры» panel (044 EARS-23, F1)", () => {
    const more = (
      props: Partial<NonNullable<React.ComponentProps<typeof FilterBar>["moreFilters"]>> = {},
    ) => ({
      label: "Все фильтры",
      appliedCount: 0,
      appliedCountLabel: (count: number) => `применено: ${count}`,
      heading: "Фильтры по данным участника",
      hint: "Применяются сразу",
      children: <label>ФИО<input /></label>,
      ...props,
    });

    it("renders no toggle at all on a bar that does not opt in", () => {
      renderBar();
      expect(
        screen.queryByRole("button", { name: /Все фильтры/ }),
      ).not.toBeInTheDocument();
    });

    it("starts closed: the toggle says so and controls a hidden panel", () => {
      renderBar({ moreFilters: more() });
      const toggle = screen.getByRole("button", { name: /Все фильтры/ });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      const panel = document.getElementById(
        toggle.getAttribute("aria-controls") ?? "",
      );
      expect(panel).not.toBeNull();
      expect(panel).not.toBeVisible();
    });

    it("opens the panel inside the same bar, with its heading and hint, and closes it again", async () => {
      const user = userEvent.setup();
      renderBar({ moreFilters: more() });
      const toggle = screen.getByRole("button", { name: /Все фильтры/ });
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      const region = screen.getByRole("region", { name: "Фильтры списка" });
      const panel = screen.getByRole("group", {
        name: "Фильтры по данным участника",
      });
      expect(region).toContainElement(panel);
      expect(panel).toBeVisible();
      expect(screen.getByText("Применяются сразу")).toBeInTheDocument();
      expect(screen.getByLabelText("ФИО")).toBeInTheDocument();
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).not.toBeVisible();
    });

    it("toggles from the keyboard (Enter and Space on the focused button)", async () => {
      const user = userEvent.setup();
      renderBar({ moreFilters: more() });
      const toggle = screen.getByRole("button", { name: /Все фильтры/ });
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      await user.keyboard(" ");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("badges the number of applied panel filters and names it, only while there is one", () => {
      const { rerender } = renderBar({ moreFilters: more({ appliedCount: 0 }) });
      expect(screen.queryByText("0")).not.toBeInTheDocument();
      rerender(
        <FilterBar
          applyMode="instant"
          label="Фильтры списка"
          resetLabel="Сбросить всё"
          moreFilters={more({ appliedCount: 2 })}
        />,
      );
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Все фильтры, применено: 2" }),
      ).toBeInTheDocument();
    });

    it("keeps «Сбросить всё» beside the chips it clears", () => {
      renderBar({
        moreFilters: more({ appliedCount: 1 }),
        applied: [{ id: "a", label: "Город: Химки", onRemove: vi.fn() }],
        appliedLabel: "Выбрано:",
        onResetAll: vi.fn(),
      });
      const reset = screen.getByRole("button", { name: "Сбросить всё" });
      const chip = screen.getByRole("button", { name: "Город: Химки" });
      expect(reset.parentElement).toBe(chip.parentElement);
    });
  });

  describe("<FilterBarTextField> — a panel text filter on the bar's instant model", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("commits once after the inactivity window, with the busy cue meanwhile", () => {
      const onCommit = vi.fn();
      render(
        <FilterBarTextField
          label="Место работы"
          value=""
          onCommit={onCommit}
          busyLabel="Идёт поиск…"
        />,
      );
      const field = screen.getByLabelText("Место работы");
      fireEvent.change(field, { target: { value: "Г" } });
      fireEvent.change(field, { target: { value: "ГКБ" } });
      expect(onCommit).not.toHaveBeenCalled();
      expect(field).toHaveAttribute("aria-busy", "true");
      expect(screen.getByText("Идёт поиск…")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith("ГКБ");
      expect(field).not.toHaveAttribute("aria-busy");
    });

    it("follows an external value change (a chip removed, «Сбросить всё»)", () => {
      const { rerender } = render(
        <FilterBarTextField label="ФИО" value="Иван" onCommit={vi.fn()} />,
      );
      expect(screen.getByLabelText("ФИО")).toHaveValue("Иван");
      rerender(<FilterBarTextField label="ФИО" value="" onCommit={vi.fn()} />);
      expect(screen.getByLabelText("ФИО")).toHaveValue("");
    });
  });
});

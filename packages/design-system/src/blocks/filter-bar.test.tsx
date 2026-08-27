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

import { FilterBar } from "./filter-bar";

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
});

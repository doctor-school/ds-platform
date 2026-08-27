import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FormActions,
  FormDerivedNote,
  FormFieldGroup,
  FormSection,
} from "./field-group";

afterEach(cleanup);

/**
 * Form layout tier (#1578, adopted from shadcn/ui `Field`, MIT). The harness pins the
 * semantics an operator form is graded on: a real fieldset/legend group, the section
 * description wired to that group, single-column-by-default field groups, and the
 * single terminal action row — a per-section save button is an ERROR, not a style
 * choice.
 */
describe("form layout blocks", () => {
  it("renders a section as a real fieldset with a real legend", () => {
    render(
      <FormSection legend="Основные сведения">
        <input aria-label="Название" />
      </FormSection>,
    );
    const group = screen.getByRole("group", { name: "Основные сведения" });
    expect(group.tagName).toBe("FIELDSET");
    expect(group.querySelector("legend")).toHaveTextContent("Основные сведения");
  });

  it("wires the section description to the group through aria-describedby", () => {
    render(
      <FormSection
        legend="Публикация"
        description="Эти поля видны врачам после публикации"
      >
        <input aria-label="Статус" />
      </FormSection>,
    );
    const group = screen.getByRole("group", { name: "Публикация" });
    expect(group).toHaveAccessibleDescription(
      "Эти поля видны врачам после публикации",
    );
  });

  it("disables every control in a locked section", () => {
    render(
      <FormSection legend="Адрес страницы" locked>
        <input aria-label="Адрес" />
      </FormSection>,
    );
    expect(screen.getByLabelText("Адрес")).toBeDisabled();
    expect(screen.getByRole("group", { name: "Адрес страницы" })).toHaveAttribute(
      "data-locked",
      "true",
    );
  });

  it("stacks fields in a single column by default and two-up only on request", () => {
    const { container, rerender } = render(
      <FormFieldGroup>
        <input aria-label="Название" />
      </FormFieldGroup>,
    );
    expect(container.firstChild).toHaveAttribute("data-columns", "one");
    expect((container.firstChild as HTMLElement).className).toContain(
      "grid-cols-1",
    );

    rerender(
      <FormFieldGroup columns="two">
        <input aria-label="Куратор" />
        <input aria-label="Дата запуска" />
      </FormFieldGroup>,
    );
    expect(container.firstChild).toHaveAttribute("data-columns", "two");
    expect((container.firstChild as HTMLElement).className).toContain(
      "sm:grid-cols-2",
    );
  });

  it("renders one terminal action row with the primary first", () => {
    const { container } = render(
      <FormActions secondary={<button type="button">Отмена</button>}>
        <button type="submit">Сохранить</button>
      </FormActions>,
    );
    expect(container.querySelectorAll('[data-form-actions="true"]')).toHaveLength(
      1,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("Сохранить");
    expect(buttons[1]).toHaveTextContent("Отмена");
  });

  it("REFUSES a per-section action row — «сохранено» must never be ambiguous", () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <FormSection legend="Основные сведения">
          <FormActions>
            <button type="submit">Сохранить раздел</button>
          </FormActions>
        </FormSection>,
      ),
    ).toThrow(/single terminal action row/);
    onError.mockRestore();
  });

  it("renders a derived value as a read-only note instead of a field", () => {
    render(
      <FormDerivedNote title="Адрес страницы">
        Создаётся сам из названия: /napravleniya/kardiologiya
      </FormDerivedNote>,
    );
    expect(screen.getByText("Адрес страницы")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

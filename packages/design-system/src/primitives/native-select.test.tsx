import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Label } from "./label";
import { NativeSelect } from "./native-select";

afterEach(cleanup);

const ROLES = [
  "Эксперт",
  "Партнёр",
  "Участник подкаста",
  "Соавтор направления",
  "Компания",
] as const;

function RoleSelect(
  props: Omit<React.ComponentProps<typeof NativeSelect>, "children"> = {},
) {
  return (
    <>
      <Label htmlFor="role">Роль</Label>
      <NativeSelect id="role" name="role" required defaultValue="" {...props}>
        <option value="" disabled>
          Выберите роль
        </option>
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

describe("NativeSelect — official shadcn native semantics with DS Input parity", () => {
  it("EARS-5: when the role field renders, the system shall preserve the exact native option order and form semantics", async () => {
    const user = userEvent.setup();
    render(<RoleSelect />);

    const select = screen.getByRole("combobox", { name: "Роль" });
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(select).toHaveAttribute("name", "role");
    expect(select).toBeRequired();
    expect(
      Array.from((select as HTMLSelectElement).options).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Выберите роль", ...ROLES]);

    await user.selectOptions(select, "Партнёр");
    expect(select).toHaveValue("Партнёр");
  });

  it("EARS-8: when the role field is focused, invalid, or disabled, the system shall carry Input-parity geometry and state classes", () => {
    render(<RoleSelect aria-invalid disabled />);

    const select = screen.getByRole("combobox", { name: "Роль" });
    expect(select).toHaveClass(
      "h-11",
      "w-full",
      "appearance-none",
      "border-2",
      "px-3.5",
      "text-sm",
      "focus-visible:border-ring",
      "focus-visible:shadow-focus",
      "hover:border-ring",
      "active:border-primary-action",
      "active:bg-muted",
      "aria-invalid:border-destructive-text",
      "aria-invalid:hover:border-destructive-text",
      "aria-invalid:active:border-destructive-text",
      "aria-invalid:bg-destructive-tint",
      "disabled:border-hairline",
      "disabled:hover:border-hairline",
      "disabled:active:border-hairline",
      "disabled:bg-muted",
      "disabled:text-muted-foreground",
    );
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute("aria-invalid", "true");
  });

  it("EARS-8: when the native select renders, the system shall forward its ref and keep the quiet chevron decorative", () => {
    const ref = React.createRef<HTMLSelectElement>();
    const { container } = render(<RoleSelect ref={ref} />);

    const select = screen.getByRole("combobox", { name: "Роль" });
    expect(ref.current).toBe(select);
    const chevron = container.querySelector("svg");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("pointer-events-none", "text-muted-foreground");
  });

  it("EARS-8: when a selected value with descenders renders, the system shall leave the select a content box at least one text-sm line tall", () => {
    // A native <select> clips its value to the content box (unlike <input>,
    // which centres its line). With `h-11` (44px) and `border-2`, `py-3`
    // left 16px for a 20px text-sm line, cutting «р»/«у» descenders (#2509).
    render(<RoleSelect defaultValue="Участник подкаста" />);

    const select = screen.getByRole("combobox", { name: "Роль" });
    const classes = select.className.split(/\s+/);
    const SPACING_PX = 4;
    const TEXT_SM_LINE_PX = 20;
    const height = classes.includes("h-11") ? 11 * SPACING_PX : NaN;
    const border = classes.includes("border-2") ? 2 : NaN;
    const py = classes
      .map((c) => /^py-(\d+(?:\.\d+)?)$/.exec(c)?.[1])
      .find((v) => v !== undefined);
    const paddingY = py === undefined ? 0 : Number(py) * SPACING_PX;
    const contentBox = height - 2 * border - 2 * paddingY;

    expect(contentBox).toBeGreaterThanOrEqual(TEXT_SM_LINE_PX);
  });

  it("EARS-8: when wrapValue is set, the system shall render the chosen option in full on a wrapping line over the still-native select (#2838)", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = React.useState("Партнёр");
      return (
        <RoleSelect
          wrapValue
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    const { container } = render(<Controlled />);
    const select = screen.getByRole("combobox", { name: "Роль" });
    const shown = container.querySelector("[data-slot='native-select-value']");
    if (!(shown instanceof HTMLElement)) throw new Error("no shown value");

    expect(shown).toHaveTextContent("Партнёр");
    expect(shown).toHaveAttribute("aria-hidden", "true");
    expect(shown.className).toContain("whitespace-normal");
    expect(shown.className).toContain("min-h-11");
    // The real control stays the native select, laid over the visible box.
    expect(select.className).toContain("opacity-0");
    expect(select.className).toContain("absolute");

    await user.selectOptions(select, "Участник подкаста");
    expect(shown).toHaveTextContent("Участник подкаста");
  });

  it("EARS-8: without wrapValue the system shall render no separate value line", () => {
    const { container } = render(<RoleSelect />);
    expect(
      container.querySelector("[data-slot='native-select-value']"),
    ).toBeNull();
  });
});

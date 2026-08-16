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
      "aria-invalid:border-destructive",
      "aria-invalid:bg-destructive-tint",
      "disabled:border-hairline",
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
});

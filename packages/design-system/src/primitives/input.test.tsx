import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "./input";

afterEach(cleanup);

/**
 * Input filled-border contract (#529, source §07 «Формы и валидация» — the `Filled`
 * cell switches the border `hairline` → the ink `border` once the field holds a
 * value). The signal is a JS has-value flag (mirroring the OTP slot's `char ?
 * border-border : border-hairline`), NOT `:placeholder-shown` — a placeholder-less
 * input is never `:placeholder-shown`, so a pure-CSS rule would misfire. It is safe
 * for controlled AND uncontrolled inputs.
 */
describe("Input filled-border (#529, source §07 filled state)", () => {
  it("#529: an empty uncontrolled input rests on the hairline border", () => {
    render(<Input data-testid="i" aria-label="e" />);
    const i = screen.getByTestId("i");
    expect(i).toHaveClass("border-hairline");
    expect(i).not.toHaveClass("border-border");
    expect(i).not.toHaveAttribute("data-filled");
  });

  it("#529: a non-empty defaultValue (uncontrolled) shows the ink border on first render", () => {
    render(<Input data-testid="i" aria-label="e" defaultValue="anna@nmic.ru" />);
    const i = screen.getByTestId("i");
    expect(i).toHaveClass("border-border");
    expect(i).not.toHaveClass("border-hairline");
    expect(i).toHaveAttribute("data-filled", "true");
  });

  it("#529: typing flips an uncontrolled input to the ink border and back when cleared", () => {
    render(<Input data-testid="i" aria-label="e" />);
    const i = screen.getByTestId("i") as HTMLInputElement;
    fireEvent.change(i, { target: { value: "x" } });
    expect(i).toHaveClass("border-border");
    fireEvent.change(i, { target: { value: "" } });
    expect(i).toHaveClass("border-hairline");
  });

  it("#529: a controlled input derives filled from the value prop each render", () => {
    const { rerender } = render(
      <Input data-testid="i" aria-label="e" value="" onChange={() => {}} />,
    );
    expect(screen.getByTestId("i")).toHaveClass("border-hairline");
    rerender(
      <Input
        data-testid="i"
        aria-label="e"
        value="anna@nmic.ru"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("i")).toHaveClass("border-border");
  });

  it("#529: still forwards onChange to the caller", () => {
    let seen = "";
    render(
      <Input
        data-testid="i"
        aria-label="e"
        onChange={(e) => {
          seen = e.target.value;
        }}
      />,
    );
    fireEvent.change(screen.getByTestId("i"), { target: { value: "hi" } });
    expect(seen).toBe("hi");
  });

  it("#529: the invalid override still wins over the filled base border", () => {
    render(
      <Input data-testid="i" aria-label="e" defaultValue="x" aria-invalid />,
    );
    const i = screen.getByTestId("i");
    expect(i).toHaveClass(
      "aria-invalid:border-destructive",
      "aria-invalid:bg-destructive-tint",
    );
  });
});

/**
 * Input success state (#529, source §07 — the `Success` cell: green `success`
 * border + pale `success-tint` fill). Threaded through the field composite via
 * `data-success`, analogous to the `aria-invalid` error path.
 */
describe("Input success state (#529, source §07 success)", () => {
  it("#529: carries the success border + tint override, keyed on data-success", () => {
    render(
      <Input
        data-testid="i"
        aria-label="e"
        data-success="true"
        defaultValue="anna@nmic.ru"
      />,
    );
    const i = screen.getByTestId("i");
    expect(i).toHaveClass(
      "data-[success=true]:border-success",
      "data-[success=true]:bg-success-tint",
    );
    expect(i).toHaveAttribute("data-success", "true");
  });
});

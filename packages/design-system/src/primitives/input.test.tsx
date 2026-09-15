import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input, inputVariants } from "./input";

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

/**
 * The header surface variant (#2180). The storefront search band used to carry
 * this stack as a `className` on the shared shell's `<Input>`, forking the
 * primitive for that one surface; the values are unchanged, they MOVED into the
 * primitive so both storefronts get the band field from one definition.
 * Canvas: `design-source/ds-shell.dc.html` line 24 (desktop) / line 62 (mobile).
 */
describe("Input header surface (#2180, canvas ds-shell.dc.html line 24)", () => {
  it("017 EARS-5: the header variant is the transparent band field — hairline, white ink, white placeholder, white focus border", () => {
    const cls = inputVariants({ variant: "header" });
    expect(cls).toMatch(/(?:^|\s)border-header-hairline(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)bg-transparent(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)font-semibold(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)text-header-foreground(?:\s|$)/);
    expect(cls).toMatch(/placeholder:text-header-foreground/);
    expect(cls).toMatch(/focus-visible:border-header-foreground/);
  });

  it("017 EARS-5: the rendered header field overrides the page-surface base and leaks no variant attribute", () => {
    render(<Input data-testid="i" aria-label="e" variant="header" />);
    const i = screen.getByTestId("i");
    expect(i).toHaveClass(
      "border-header-hairline",
      "bg-transparent",
      "text-header-foreground",
      "placeholder:text-header-foreground",
      "focus-visible:border-header-foreground",
    );
    // The base page-surface values lose to the variant (tailwind-merge).
    expect(i).not.toHaveClass("bg-background", "border-hairline", "text-foreground");
    expect(i).not.toHaveAttribute("variant");
  });

  it("017 EARS-5: the default variant leaves the page-surface field untouched", () => {
    expect(inputVariants()).not.toMatch(/header/);
  });
});

import * as React from "react";
import { useForm } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form";
import { Input } from "./input";

afterEach(cleanup);

/**
 * Form primitive contract (ADR-0013 §7 form layout & validation contract, #333
 * redo of the slice-B standard). The owner-picked standard is **inline (1A)**:
 *  - a resting field with neither helper nor error renders **no** message element
 *    at all (no reserved blank line — the slice-B over-spacing defect K-1);
 *  - the message shows the helper by default and SWAPS the error in place;
 *  - the error text is small (`text-xs`) and **not bold**, and the field's
 *    invalidity is carried by the input border, NOT a red label (K-3 "red mush");
 *  - the FormLabel stays neutral even on error.
 */
function Harness({
  error,
  helper,
}: {
  error?: string;
  helper?: string;
}) {
  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  // Inject an error once after mount so the test does not depend on a resolver
  // (setting it during render would loop).
  React.useEffect(() => {
    if (error) form.setError("name", { message: error });
    // Run once per `error` value.
  }, [error, form]);
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem data-testid="item">
            <FormLabel data-testid="label">Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage data-testid="message">{helper}</FormMessage>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("FormMessage inline (no reserved line, no reflow over-spacing)", () => {
  it("renders NOTHING when there is neither a helper nor an error (no reserved line)", () => {
    render(<Harness />);
    // K-1: a resting field with no message reserves no blank line.
    expect(screen.queryByTestId("message")).not.toBeInTheDocument();
  });

  it("shows the error inline, small and NOT bold, announced as an alert", () => {
    render(<Harness error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    expect(msg).toHaveClass("text-xs", "text-destructive");
    // K-3 / owner: the error text is not bold ("выглядит тяжело").
    expect(msg).not.toHaveClass("font-medium");
    // No reserved-height slot anymore (inline grows on demand).
    expect(msg).not.toHaveClass("min-h-5");
    expect(msg).toHaveAttribute("role", "alert");
  });

  it("shows the helper by default (muted, small, visible, no alert)", () => {
    render(<Harness helper="We never share this." />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("We never share this.");
    expect(msg).toHaveClass("text-xs", "text-muted-foreground");
    expect(msg).not.toHaveAttribute("aria-hidden");
    expect(msg).not.toHaveAttribute("role", "alert");
  });

  it("swaps the error into the helper's place on failure (they never coexist)", () => {
    render(<Harness helper="We never share this." error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    expect(msg.textContent).not.toContain("We never share this.");
    expect(msg).toHaveClass("text-xs", "text-destructive");
    expect(msg).toHaveAttribute("role", "alert");
  });
});

describe("FormLabel stays neutral on error (K-3 — no red label)", () => {
  it("does not turn the label destructive when the field is invalid", () => {
    render(<Harness error="Required" />);
    const label = screen.getByTestId("label");
    // The error is carried by the input border + message, not a red label.
    expect(label).not.toHaveClass("text-destructive");
  });
});

describe("FormItem label↔control gap (focus ring clearance, unchanged)", () => {
  it("lays out as a flex column with the ring-clearing gap", () => {
    render(<Harness />);
    const item = screen.getByTestId("item");
    expect(item).toHaveClass("flex", "flex-col", "gap-2.5");
  });
});

describe("Input invalid state (K-3 — red border carries the error)", () => {
  it("carries an aria-invalid destructive border + ring (not a neutral border)", () => {
    render(<Input aria-invalid data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    expect(inp).toHaveClass(
      "aria-invalid:border-destructive",
      "aria-invalid:focus-visible:ring-destructive",
    );
  });
});

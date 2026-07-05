import * as React from "react";
import { useForm } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Form,
  FormControl,
  FormError,
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

  it("shows the error inline — 12/700 danger with a ⚠ marker, announced as an alert", () => {
    render(<Harness error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    // Neo-brutalist error row (#512): 12/700 danger (`text-xs font-bold text-destructive`).
    expect(msg).toHaveClass("text-xs", "font-bold", "text-destructive");
    // The ⚠ marker leads the row and is DECORATIVE: it lives in an aria-hidden
    // element so a screen reader announces just the message (the row already
    // carries role="alert"), never the emoji name.
    expect(msg.textContent).toContain("⚠");
    const marker = msg.querySelector('[aria-hidden="true"]');
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain("⚠");
    // No reserved-height slot anymore (inline grows on demand).
    expect(msg).not.toHaveClass("min-h-5");
    expect(msg).toHaveAttribute("role", "alert");
  });

  it("shows the helper by default (muted, small, NOT bold, no ⚠, no alert)", () => {
    render(<Harness helper="We never share this." />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("We never share this.");
    // The helper stays quiet: muted, not bold, no danger marker (only the error is loud).
    expect(msg).toHaveClass("text-xs", "text-muted-foreground");
    expect(msg).not.toHaveClass("font-bold");
    expect(msg.textContent).not.toContain("⚠");
    expect(msg).not.toHaveAttribute("aria-hidden");
    expect(msg).not.toHaveAttribute("role", "alert");
  });

  it("swaps the error into the helper's place on failure (they never coexist)", () => {
    render(<Harness helper="We never share this." error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    expect(msg.textContent).not.toContain("We never share this.");
    expect(msg).toHaveClass("text-xs", "font-bold", "text-destructive");
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

describe("FormError — single form-level error primitive (one error style source)", () => {
  it("renders nothing when there is no message", () => {
    render(<FormError data-testid="ferr">{null}</FormError>);
    expect(screen.queryByTestId("ferr")).not.toBeInTheDocument();
  });

  it("renders the submit/auth error in the SAME style as a field error (12/700 danger + ⚠, alert)", () => {
    render(<FormError data-testid="ferr">Не удалось войти.</FormError>);
    const err = screen.getByTestId("ferr");
    expect(err).toHaveTextContent("Не удалось войти.");
    // Same shared style as FormMessage's error branch — the look lives in one place.
    expect(err).toHaveClass("text-xs", "font-bold", "text-destructive");
    expect(err.textContent).toContain("⚠");
    // The ⚠ marker is decorative (aria-hidden) — SR reads just the error text.
    expect(err.querySelector('[aria-hidden="true"]')?.textContent).toContain("⚠");
    expect(err).toHaveAttribute("role", "alert");
  });
});

describe("Input invalid state (K-3 — red border carries the error)", () => {
  it("carries an aria-invalid destructive border + tint + ring (not a neutral border)", () => {
    render(<Input aria-invalid data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    expect(inp).toHaveClass(
      "aria-invalid:border-destructive",
      // neo-brutalist error (#512): a faint danger tint fills the field, too.
      "aria-invalid:bg-destructive/10",
      "aria-invalid:focus-visible:ring-destructive",
    );
  });
});

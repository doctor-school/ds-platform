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
 * Form primitive contract (ADR-0013 §7 form layout & validation contract, #324):
 *  - the field reserves a constant-height message slot, so showing/hiding a
 *    validation message does NOT reflow the form (defect #7);
 *  - the slot shows the field's helper by default and SWAPS the error into the
 *    SAME slot in place on failure — helper and error never coexist (defect #1 vs
 *    #7 reconciled);
 *  - the empty slot is hidden from the a11y tree until there is real content;
 *  - FormItem lays out as a flex column with a ring-clearing label→control gap so
 *    the focus ring never touches the label.
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
            <FormLabel>Name</FormLabel>
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

describe("FormMessage reserved slot (no reflow on error)", () => {
  it("always renders the message slot, even with no error", () => {
    render(<Harness />);
    const msg = screen.getByTestId("message");
    expect(msg).toBeInTheDocument();
    // Reserves one line of height so the field group does not grow on error.
    expect(msg).toHaveClass("min-h-5");
  });

  it("hides the empty slot from the a11y tree until there is a message", () => {
    render(<Harness />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveAttribute("aria-hidden", "true");
    expect(msg.textContent).toBe("");
  });

  it("shows the error text and drops aria-hidden when an error is present", () => {
    render(<Harness error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    expect(msg).not.toHaveAttribute("aria-hidden");
    // The slot is the SAME element whether empty or filled — same reserved height,
    // so toggling the error does not change the field-group height.
    expect(msg).toHaveClass("min-h-5");
  });

  it("styles the resting empty slot as muted, not destructive", () => {
    render(<Harness />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveClass("text-muted-foreground");
    expect(msg).not.toHaveClass("text-destructive");
  });

  it("styles the error state as a destructive alert", () => {
    render(<Harness error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveClass("font-medium", "text-destructive");
    // Announced as an error.
    expect(msg).toHaveAttribute("role", "alert");
  });
});

describe("FormMessage helper↔error swap (one slot, in place)", () => {
  it("shows the helper by default (muted, visible, same slot)", () => {
    render(<Harness helper="We never share this." />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("We never share this.");
    expect(msg).toHaveClass("min-h-5", "text-muted-foreground");
    // A real helper is visible to assistive tech.
    expect(msg).not.toHaveAttribute("aria-hidden");
  });

  it("swaps the error into the helper's slot in place on failure", () => {
    render(<Harness helper="We never share this." error="Required" />);
    const msg = screen.getByTestId("message");
    // Error replaces the helper text in the SAME slot — they never coexist.
    expect(msg).toHaveTextContent("Required");
    expect(msg.textContent).not.toContain("We never share this.");
    expect(msg).toHaveClass("min-h-5", "text-destructive");
    expect(msg).toHaveAttribute("role", "alert");
  });
});

describe("FormItem label↔control gap (focus ring clearance)", () => {
  it("lays out as a flex column with a ring-clearing gap (not the old space-y-2)", () => {
    render(<Harness />);
    const item = screen.getByTestId("item");
    expect(item).toHaveClass("flex", "flex-col", "gap-2.5");
  });
});

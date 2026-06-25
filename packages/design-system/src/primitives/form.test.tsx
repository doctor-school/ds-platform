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
 * Form primitive contract (#227/#267 owner findings, fixed systemically):
 *  - the field group reserves a constant-height message slot, so showing/hiding a
 *    validation message does NOT reflow the form (finding 7);
 *  - the empty slot is hidden from the a11y tree until there is a real message;
 *  - FormItem lays out as a flex column with a clear label→control gap so the
 *    focus ring never touches the label (finding 1).
 */
function Harness({ error }: { error?: string }) {
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
            <FormMessage data-testid="message" />
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
});

describe("FormItem label↔control gap (focus ring clearance)", () => {
  it("lays out as a flex column with a clear gap (not the old space-y-2)", () => {
    render(<Harness />);
    const item = screen.getByTestId("item");
    expect(item).toHaveClass("flex", "flex-col", "gap-2.5");
  });
});

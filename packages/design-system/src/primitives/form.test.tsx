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
 *  - the error is the neo-brutalist tone (#512, source §07): small (`text-xs`),
 *    **weight 700** danger with a leading `⚠` glyph — the field's invalidity is
 *    carried by the input border + this message, NOT a red label (K-3 "red mush");
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

  it("shows the error inline as the source's ⚠ + weight-700 danger, announced as an alert", () => {
    render(<Harness error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    // Neo-brutalist error (#512, source §07): 12px weight-700 danger with the
    // leading ⚠ glyph — supersedes the prior slice-B "not bold" tone.
    expect(msg).toHaveClass("text-xs", "font-bold", "text-destructive-text");
    expect(msg.textContent ?? "").toContain("⚠");
    // No reserved-height slot (inline grows on demand).
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
    expect(msg).toHaveClass("text-xs", "text-destructive-text");
    expect(msg).toHaveAttribute("role", "alert");
  });
});

/**
 * Success tone (#529, source §07 «Формы и валидация» — the `Success` cell renders a
 * green `✓ Адрес подтверждён` confirmation under the field). `FormMessage` gains a
 * `success` prop: when set with confirmation copy and NO error, it renders the green
 * weight-700 tone with a leading `✓`, announced politely as a `status`. An error
 * always wins (error > success > helper — they never coexist).
 */
function SuccessHarness({
  message,
  error,
}: {
  message?: string;
  error?: string;
}) {
  const form = useForm<{ name: string }>({ defaultValues: { name: "" } });
  React.useEffect(() => {
    if (error) form.setError("name", { message: error });
  }, [error, form]);
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage data-testid="message" success>
              {message}
            </FormMessage>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("FormMessage success tone (#529, source §07 — ✓ + green confirmation)", () => {
  it("#529: renders confirmation copy as green weight-700 with a leading ✓, announced as status", () => {
    render(<SuccessHarness message="Адрес подтверждён" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Адрес подтверждён");
    // Source §07 success: 12px weight-700 in the AA-safe success TEXT colour
    // (`success-text`, the green mirror of `destructive-text`), NOT the fill.
    expect(msg).toHaveClass("text-xs", "font-bold", "text-success-text");
    expect(msg.textContent ?? "").toContain("✓");
    expect(msg).toHaveAttribute("role", "status");
  });

  it("#529: an error still wins over success (they never coexist)", () => {
    render(<SuccessHarness message="Адрес подтверждён" error="Required" />);
    const msg = screen.getByTestId("message");
    expect(msg).toHaveTextContent("Required");
    expect(msg.textContent).not.toContain("Адрес подтверждён");
    expect(msg).toHaveClass("text-destructive-text");
    expect(msg.textContent ?? "").toContain("⚠");
    expect(msg).toHaveAttribute("role", "alert");
  });

  it("#529: success with no confirmation copy renders nothing (no empty green line)", () => {
    render(<SuccessHarness />);
    expect(screen.queryByTestId("message")).not.toBeInTheDocument();
  });
});

describe("FormLabel stays neutral on error (K-3 — no red label)", () => {
  it("does not turn the label destructive when the field is invalid", () => {
    render(<Harness error="Required" />);
    const label = screen.getByTestId("label");
    // The error is carried by the input border + message, not a red label.
    expect(label).not.toHaveClass("text-destructive-text");
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

  it("renders the submit/auth error in the SAME neo-brutalist style as a field error (text-xs weight-700 danger + ⚠, alert)", () => {
    render(<FormError data-testid="ferr">Не удалось войти.</FormError>);
    const err = screen.getByTestId("ferr");
    expect(err).toHaveTextContent("Не удалось войти.");
    // Same shared style as FormMessage's error branch — the look lives in one place
    // (#512, source §07): weight-700 danger with the leading ⚠ glyph.
    expect(err).toHaveClass("text-xs", "font-bold", "text-destructive-text");
    expect(err.textContent ?? "").toContain("⚠");
    expect(err).toHaveAttribute("role", "alert");
  });
});

describe("Input invalid state (K-3 — red border + danger tint carry the error)", () => {
  it("carries an aria-invalid destructive border + pale danger-tint fill (not a neutral border)", () => {
    render(<Input aria-invalid data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    // Neo-brutalist error (#512, source §07): destructive 2px border + the pale
    // `destructive-tint` (dangerTint) fill, set by aria-invalid on the control.
    expect(inp).toHaveClass(
      "aria-invalid:border-destructive",
      "aria-invalid:bg-destructive-tint",
    );
  });
});

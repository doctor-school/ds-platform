"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Form LAYOUT tier (#1578, owner Stage-A pick A — «ruled sections»).
 *
 * ADOPTED from official shadcn/ui's `Field` family (MIT — Copyright (c) 2023 shadcn;
 * https://ui.shadcn.com/docs/components/field): `FieldSet` / `FieldLegend` /
 * `FieldDescription` / `FieldGroup` / `FieldSeparator` — the layout tier shadcn added
 * ABOVE the `Form*` field wrapper we already run. Renamed to the `Form*` family so it
 * reads as one vocabulary with the existing `FormItem` / `FormLabel` / `FormControl` /
 * `FormMessage`, and re-skinned to DS tokens. No new runtime dependency; composes with
 * react-hook-form exactly as `FormField`/`FormItem` do. Origin UI (off the ADR-0013 §4
 * whitelist — mixed per-directory licensing inside `cosscom/coss` over a collection
 * frozen at the absorption) and Intent/Jolly (a second React-Aria form-state stack)
 * were rejected; Kibo has no field-group block at all.
 *
 * The three rules it encodes:
 * 1. GROUP, THEN LABEL THE GROUP SEMANTICALLY. A section is a real `fieldset` with a
 *    real `legend` — never a bare `<h2>` followed by loose divs, which carries no
 *    programmatic grouping and leaves a screen-reader user hearing seven unlabelled
 *    fields in a row. The section description is wired to the fieldset through
 *    `aria-describedby`, so it is announced with the group, not orphaned.
 * 2. SINGLE COLUMN; two-up only for genuinely paired short fields (`columns="two"`,
 *    which collapses back to one column below `sm`) — multiple columns interrupt the
 *    vertical momentum of moving down the form (NN/g).
 * 3. ONE TERMINAL ACTION ROW per form, left-aligned, primary first (GOV.UK), with the
 *    secondary at reduced prominence (NN/g). A per-section save button would make
 *    "saved" ambiguous, so `FormActions` THROWS when rendered inside a `FormSection` —
 *    the invariant is enforced, not documented.
 *
 * `FormDerivedNote` is the counterpart of "a field the operator must not fill is not
 * rendered at all": a derived value (slug, ordering weight) shows as a read-only note
 * stating what it will be, instead of a numeric box nobody can reason about.
 */

/** True while rendering inside a `FormSection` — guards the single-action-row rule. */
const SectionContext = React.createContext(false);

export interface FormSectionProps extends Omit<
  React.FieldsetHTMLAttributes<HTMLFieldSetElement>,
  "title"
> {
  /** The section's statement heading — rendered as a real `<legend>`. */
  legend: React.ReactNode;
  /** One line of section context (the place for what would bloat a field hint). */
  description?: React.ReactNode;
  /** A section the server refuses to change (e.g. after first publication). */
  locked?: boolean;
}

export function FormSection({
  legend,
  description,
  locked = false,
  className,
  children,
  ...rest
}: FormSectionProps) {
  const descriptionId = React.useId();
  return (
    <SectionContext.Provider value={true}>
      {/* `{...rest}` goes FIRST: the computed attributes below are the section's
          contract, and a caller's `disabled={false}` must not be able to un-lock a
          locked section (nor clobber `aria-describedby` / `data-locked`). */}
      <fieldset
        {...rest}
        disabled={locked || rest.disabled}
        aria-describedby={
          description ? descriptionId : rest["aria-describedby"]
        }
        data-locked={locked ? "true" : undefined}
        className={cn(
          "flex flex-col gap-4 border-t border-hairline pt-6 first:border-t-0 first:pt-0",
          className,
        )}
      >
        {/* The `<legend>` must be the fieldset's FIRST child — that adjacency is
            what names the group for assistive tech; wrapping it in a div silently
            drops the group's accessible name. */}
        <legend className="text-base font-extrabold tracking-tight text-foreground">
          {legend}
        </legend>
        {description ? (
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </fieldset>
    </SectionContext.Provider>
  );
}

export interface FormFieldGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `two` = a two-up row for genuinely paired short fields; collapses below `sm`. */
  columns?: "one" | "two";
}

export function FormFieldGroup({
  columns = "one",
  className,
  ...rest
}: FormFieldGroupProps) {
  return (
    <div
      data-columns={columns}
      className={cn(
        "grid gap-4",
        columns === "two" ? "sm:grid-cols-2" : "grid-cols-1",
        className,
      )}
      {...rest}
    />
  );
}

/** A hairline rule between sections where the border alone is not enough. */
export function FormSeparator({
  className,
  ...rest
}: React.HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn("border-t border-hairline", className)} {...rest} />;
}

/**
 * `NODE_ENV` without `@types/node`: the package is browser-targeted and does not carry
 * node typings, and bundlers statically replace this expression. Absent `process`
 * entirely (a raw browser ESM load), we fall back to the production behaviour — degrade,
 * never white-screen.
 */
declare const process: { env?: { NODE_ENV?: string } } | undefined;

function isDevelopment(): boolean {
  return (
    typeof process !== "undefined" && process?.env?.NODE_ENV !== "production"
  );
}

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional secondary/cancel node, rendered after the primary at low prominence. */
  secondary?: React.ReactNode;
}

export function FormActions({
  secondary,
  className,
  children,
  ...rest
}: FormActionsProps) {
  const insideSection = React.useContext(SectionContext);
  // A DEVELOPMENT invariant: throwing during render is the loudest signal while the
  // form is being written, but in production the same throw would white-screen the
  // admin page over a layout mistake the operator can do nothing about — there the
  // misplaced row still renders (wrong, not fatal).
  if (insideSection && isDevelopment()) {
    throw new Error(
      "FormActions must be the form's single terminal action row — a per-section " +
        "action row makes «saved» ambiguous. Move it outside FormSection.",
    );
  }
  return (
    <div
      data-form-actions="true"
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-hairline pt-6",
        className,
      )}
      {...rest}
    >
      {children}
      {secondary}
    </div>
  );
}

export interface FormDerivedNoteProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** What the derived value is called («Адрес страницы»). */
  title: React.ReactNode;
  /** The derived value itself, and when it locks. */
  children: React.ReactNode;
}

export function FormDerivedNote({
  title,
  className,
  children,
  ...rest
}: FormDerivedNoteProps) {
  return (
    <div
      className={cn("flex flex-col gap-1 bg-tint p-3.5", className)}
      {...rest}
    >
      <span className="text-caption font-bold text-tint-foreground">
        {title}
      </span>
      {/* A derived value is machine-made — a public link, a slug, an id — so it
          is often ONE token whose only break opportunities are its hyphens. Left
          unbroken, a long one is wider than a phone viewport and the page itself
          side-scrolls (#1674). The break belongs to the value box, once, here. */}
      <span className="break-all text-xs text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

"use client";

import * as React from "react";

import { CONGRESS_BIRTH_DATE_MIN } from "@ds/schemas";
import { FormError, FormItem } from "@ds/design-system/form";
import { Input } from "@ds/design-system/input";
import { Label } from "@ds/design-system/label";

import { COPY } from "../copy";

/**
 * 046 EARS-19 — the birth-date field of the poster flow (canvas field `birth`:
 * «Дата рождения», a 200px control, the hint «Спрашиваем один раз — перед
 * первым постером. {правило}.» and «Укажите дату рождения» under it). The
 * control is the DS `Input type="date"` — the browser's date control is the
 * picker and owns entry (the recorded admin precedent: no date-picker
 * runtime), so only a calendar day from 1900 up to today in Moscow can land in
 * it. One element serves the step before the first poster draft and the
 * correction inside that draft.
 */
export function BirthField({
  value,
  max,
  hint,
  error,
  onChange,
  onBlur,
}: {
  /** `YYYY-MM-DD` or "" — the date control's own value. */
  value: string;
  /** Today's Moscow day `YYYY-MM-DD` — the latest day the API accepts. */
  max: string;
  hint: string;
  error: string | null;
  onChange: (next: string) => void;
  onBlur?: () => void;
}) {
  return (
    <FormItem>
      <Label htmlFor="in-birth">{COPY.birthDate}</Label>
      {/* The DS form composition has no context-free helper line yet
          (`FormDescription` needs a react-hook-form `FormField`), so the
          canvas hint keeps its own line, wired to the control. */}
      <p
        id="in-birth-hint"
        className="text-pretty text-caption leading-normal text-muted-foreground"
      >
        {hint}
      </p>
      <div className="max-w-50">
        <Input
          id="in-birth"
          type="date"
          value={value}
          min={CONGRESS_BIRTH_DATE_MIN}
          max={max}
          autoComplete="bday"
          aria-describedby="in-birth-hint"
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      </div>
      <FormError>{error}</FormError>
    </FormItem>
  );
}

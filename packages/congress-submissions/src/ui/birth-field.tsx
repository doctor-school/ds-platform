"use client";

import * as React from "react";

import { Input } from "@ds/design-system/input";

import { COPY } from "../copy";

/**
 * 046 EARS-19 — the birth-date field of the poster flow (canvas field `birth`:
 * «Дата рождения», placeholder «дд.мм.гггг», a 200px input, the hint «Спрашиваем
 * один раз — перед первым постером. {правило}.» and «Укажите дату рождения»
 * under it). One element serves the step before the first poster draft and
 * the correction inside that draft.
 */
export function BirthField({
  value,
  hint,
  error,
  onChange,
  onBlur,
}: {
  value: string;
  hint: string;
  error: string | null;
  onChange: (next: string) => void;
  onBlur?: () => void;
}) {
  return (
    <div>
      <label
        htmlFor="in-birth"
        className="mb-2 block text-sm font-bold text-foreground"
      >
        {COPY.birthDate}
      </label>
      <p
        id="in-birth-hint"
        className="-mt-0.5 mb-2.25 text-pretty text-caption leading-normal text-muted-foreground"
      >
        {hint}
      </p>
      <div className="max-w-50">
        <Input
          id="in-birth"
          value={value}
          inputMode="numeric"
          autoComplete="bday"
          placeholder={COPY.birthPlaceholder}
          aria-describedby="in-birth-hint"
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-caption font-semibold text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

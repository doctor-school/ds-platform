"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Combobox, type ComboboxOption } from "@ds/design-system/blocks";
import type { SlotProps } from "@/components/combobox-slot-props";
import { fetchSpecialtySearchPage } from "@/lib/desk-entry-references";
import { useServerCombobox } from "@/lib/use-server-combobox";

/** The «any» option's value: never an id, so it cannot collide with one. */
export const SPECIALTY_ANY_VALUE = "__any__";

/**
 * The ONE «Специальность» selector of the congress admin — the desk entry's
 * field (044 EARS-35) and the roster's filter (044 EARS-23) mount it, so the
 * closed Минздрав book is searched one way everywhere: the server read
 * (`GET /v1/public/specialties/search?q=`) through the shared server-combobox
 * hook, the first, empty search being the whole book. The value is the
 * specialty id.
 *
 * `anyLabel` adds a leading «any» option while a value is chosen — a filter
 * needs a way back to «not applied» from the control itself; a form field does
 * not offer one.
 */
export function SpecialtyCombobox({
  id,
  testId,
  value,
  onValueChange,
  placeholder,
  anyLabel,
  invalid,
  onBookFailed,
  onSelectedLabel,
  "aria-describedby": describedBy,
  ...slot
}: SlotProps & {
  id: string;
  testId: string;
  /** The chosen specialty id, or `null`. */
  value: string | null;
  /** A specialty id, or `null` for the «any» option. */
  onValueChange: (id: string | null) => void;
  placeholder: string;
  anyLabel?: string;
  invalid?: boolean;
  /** The book read failed (or recovered) — the host draws the refusal. */
  onBookFailed?: (failed: boolean) => void;
  /** The chosen id's name once the book carries it (a chip label, …). */
  onSelectedLabel?: (label: string | null) => void;
  "aria-describedby"?: string;
}) {
  const t = useTranslations();
  const fetchPage = useCallback(
    ({ q }: { q: string }) => fetchSpecialtySearchPage({ q }),
    [],
  );
  const specialties = useServerCombobox({
    fetchPage,
    toOption: (entry) => ({ id: entry.id, label: entry.name }),
    selectedId: value,
  });

  const failed = specialties.isError;
  useEffect(() => onBookFailed?.(failed), [failed, onBookFailed]);

  const selectedLabel = value
    ? (specialties.options.find((option) => option.value === value)?.label ??
      null)
    : null;
  useEffect(() => onSelectedLabel?.(selectedLabel), [
    selectedLabel,
    onSelectedLabel,
  ]);

  const options = useMemo<ComboboxOption[]>(
    () =>
      anyLabel && value
        ? [{ value: SPECIALTY_ANY_VALUE, label: anyLabel }, ...specialties.options]
        : specialties.options,
    [anyLabel, specialties.options, value],
  );

  return (
    <Combobox
      id={id}
      data-testid={testId}
      options={options}
      value={value}
      onValueChange={(next) => {
        if (next === SPECIALTY_ANY_VALUE) {
          onValueChange(null);
          return;
        }
        specialties.select(next);
        onValueChange(next);
      }}
      onSearchChange={specialties.search}
      placeholder={
        specialties.isLoading && specialties.options.length === 0
          ? t("congressRoster.deskEntry.fields.specialtyLoading")
          : placeholder
      }
      searchLabel={t("congressRoster.deskEntry.fields.specialtySearch")}
      searchPlaceholder={t(
        "congressRoster.deskEntry.fields.specialtySearchPlaceholder",
      )}
      emptyLabel={t("congressRoster.deskEntry.fields.referenceEmpty")}
      showSearch
      invalid={invalid}
      aria-describedby={describedBy}
      {...slot}
    />
  );
}

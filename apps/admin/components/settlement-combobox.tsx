"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Combobox, type ComboboxOption } from "@ds/design-system/blocks";
import {
  freeSettlementText,
  freeSettlementValue,
  settlementOption,
  settlementOptions,
} from "@/lib/settlements";

/** The «any» option's value — neither a directory nor a typed-place value. */
export const SETTLEMENT_ANY_VALUE = "__any__";

/**
 * The ONE «Населённый пункт» selector of the congress admin — the desk entry's
 * field (044 EARS-35) and the roster's «Город» filter (044 EARS-23) mount it:
 * the bundled ОКТМО directory searched by name prefix (`lib/settlements.ts`),
 * plus the list's last option taking the typed place as written. The value is
 * an option value of that module (`dir:<n>` / `free:<text>`); the host resolves
 * it with `resolveSettlement`.
 *
 * `anyLabel` adds a leading «any» option while a value is chosen (a filter's
 * way back to «not applied»); it is reported as `null`.
 */
export function SettlementCombobox({
  id,
  testId,
  value,
  onValueChange,
  placeholder,
  anyLabel,
  invalid,
  "aria-describedby": describedBy,
}: {
  id: string;
  testId: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder: string;
  anyLabel?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const found = settlementOptions(query);
    const typed = query.trim();
    const free: ComboboxOption[] = typed
      ? [
          {
            value: freeSettlementValue(typed),
            label: t("congressRoster.deskEntry.fields.cityFree", {
              name: typed,
            }),
          },
        ]
      : [];
    // The committed choice stays an option, so the closed control keeps
    // reading it while a new search narrows the list away from it.
    const current = value ? chosenOption(value) : null;
    const kept =
      current && !found.some((option) => option.value === current.value)
        ? [current]
        : [];
    const any: ComboboxOption[] =
      anyLabel && value ? [{ value: SETTLEMENT_ANY_VALUE, label: anyLabel }] : [];
    return [...any, ...kept, ...found, ...free];
  }, [anyLabel, query, t, value]);

  return (
    <Combobox
      id={id}
      data-testid={testId}
      options={options}
      value={value}
      onValueChange={(next) =>
        onValueChange(next === SETTLEMENT_ANY_VALUE ? null : next)
      }
      onSearchChange={setQuery}
      placeholder={placeholder}
      searchLabel={t("congressRoster.deskEntry.fields.citySearch")}
      searchPlaceholder={t("congressRoster.deskEntry.fields.cityPlaceholder")}
      emptyLabel={t("congressRoster.deskEntry.fields.referenceEmpty")}
      showSearch
      invalid={invalid}
      aria-describedby={describedBy}
    />
  );
}

/** The option a committed value reads as: its directory entry, or the typed text. */
function chosenOption(value: string): ComboboxOption | null {
  const free = freeSettlementText(value);
  if (free !== null) return { value, label: free };
  return settlementOption(value);
}

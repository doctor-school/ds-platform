"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Input, Label, NativeSelect } from "@ds/design-system";
import {
  Combobox,
  FilterBarTextField,
  type ComboboxOption,
} from "@ds/design-system/blocks";
import { CONGRESS_ROSTER_MAIL_STATUS_FILTERS } from "@ds/schemas";
import { SettlementCombobox } from "@/components/settlement-combobox";
import { SpecialtyCombobox } from "@/components/specialty-combobox";
import type { RosterColumnFilters } from "@/lib/congress-roster";
import {
  freeSettlementValue,
  resolveSettlement,
  settlementRegions,
} from "@/lib/settlements";

const REGION_ANY_VALUE = "__any__";

/**
 * 044 EARS-23 — the controls of the roster's «Все фильтры» panel (owner layout
 * F1, #2316), laid on the `FilterBar` panel grid: ФИО · Место работы · Город ·
 * Регион / Телефон · Email · Специальность · Статус письма / Дата регистрации.
 * Text filters commit on the bar's debounce; the books (город, регион,
 * специальность) are searchable selectors over the same directories the desk
 * entry uses (owner refinement); everything else applies on change.
 */
export function RosterFiltersPanel({
  filters,
  onChange,
  onSpecialtyLabel,
}: {
  filters: RosterColumnFilters;
  onChange: (next: RosterColumnFilters) => void;
  onSpecialtyLabel: (label: string | null) => void;
}) {
  const t = useTranslations();
  const set = <K extends keyof RosterColumnFilters>(
    key: K,
    value: RosterColumnFilters[K],
  ) => onChange({ ...filters, [key]: value });
  const label = (key: string) => t(`congressRoster.filters.columns.${key}`);
  const contains = t("congressRoster.filters.placeholders.contains");
  const busy = t("common.list.busy");
  const placeAny = t("congressRoster.filters.placeholders.placeAny");

  const regionOptions = useMemo<ComboboxOption[]>(() => {
    const book = settlementRegions().map((region) => ({
      value: region,
      label: region,
    }));
    // A stored region the directory does not hold (a foreign country typed at
    // the desk) stays readable in the closed control.
    const kept =
      filters.region && !book.some((o) => o.value === filters.region)
        ? [{ value: filters.region, label: filters.region }]
        : [];
    const any = filters.region
      ? [{ value: REGION_ANY_VALUE, label: placeAny }]
      : [];
    return [...any, ...kept, ...book];
  }, [filters.region, placeAny]);

  const textField = (
    key: "name" | "workplace" | "email" | "phone",
    placeholder = contains,
  ) => (
    <FilterBarTextField
      id={`roster-filter-${key}`}
      label={label(key)}
      value={filters[key]}
      onCommit={(value) => set(key, value.trim())}
      placeholder={placeholder}
      busyLabel={busy}
      inputMode={key === "phone" ? "tel" : key === "email" ? "email" : undefined}
    />
  );

  return (
    <>
      {textField("name")}
      {textField("workplace")}
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="roster-filter-city">{label("city")}</Label>
        <SettlementCombobox
          id="roster-filter-city"
          testId="roster-filter-city"
          value={filters.city ? freeSettlementValue(filters.city) : null}
          onValueChange={(value) =>
            set("city", value ? (resolveSettlement(value)?.city ?? "") : "")
          }
          placeholder={placeAny}
          anyLabel={placeAny}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="roster-filter-region">{label("region")}</Label>
        <Combobox
          id="roster-filter-region"
          data-testid="roster-filter-region"
          options={regionOptions}
          value={filters.region || null}
          onValueChange={(value) =>
            set("region", value === REGION_ANY_VALUE ? "" : value)
          }
          placeholder={placeAny}
          searchLabel={t("congressRoster.filters.regionSearch")}
          searchPlaceholder={t(
            "congressRoster.deskEntry.fields.specialtySearchPlaceholder",
          )}
          emptyLabel={t("congressRoster.deskEntry.fields.referenceEmpty")}
          showSearch
        />
      </div>
      {textField("phone", t("congressRoster.filters.placeholders.phone"))}
      {textField("email")}
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="roster-filter-specialty">{label("specialty")}</Label>
        <SpecialtyCombobox
          id="roster-filter-specialty"
          testId="roster-filter-specialty"
          value={filters.specialtyId || null}
          onValueChange={(id) => set("specialtyId", id ?? "")}
          placeholder={t("congressRoster.filters.placeholders.specialtyAny")}
          anyLabel={t("congressRoster.filters.placeholders.specialtyAny")}
          onSelectedLabel={onSpecialtyLabel}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="roster-filter-mail">{label("mailStatus")}</Label>
        <NativeSelect
          id="roster-filter-mail"
          data-testid="roster-filter-mail"
          value={filters.mailStatus}
          onChange={(event) =>
            set(
              "mailStatus",
              event.target.value as RosterColumnFilters["mailStatus"],
            )
          }
        >
          <option value="">{t("congressRoster.filters.mailStatus.any")}</option>
          {CONGRESS_ROSTER_MAIL_STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {t(`congressRoster.filters.mailStatus.${status}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div
        role="group"
        aria-labelledby="roster-filter-registered-label"
        className="flex min-w-0 flex-col gap-1.5 sm:col-span-2"
      >
        <span
          id="roster-filter-registered-label"
          className="text-xs font-bold leading-none text-foreground"
        >
          {label("registered")}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground" aria-hidden="true">
            {t("congressRoster.filters.registeredFrom")}
          </span>
          <Input
            type="date"
            data-testid="roster-filter-registered-from"
            aria-label={t("congressRoster.filters.registeredFromLabel")}
            value={filters.registeredFrom}
            max={filters.registeredTo || undefined}
            onChange={(event) => set("registeredFrom", event.target.value)}
          />
          <span className="text-caption text-muted-foreground" aria-hidden="true">
            {t("congressRoster.filters.registeredTo")}
          </span>
          <Input
            type="date"
            data-testid="roster-filter-registered-to"
            aria-label={t("congressRoster.filters.registeredToLabel")}
            value={filters.registeredTo}
            min={filters.registeredFrom || undefined}
            onChange={(event) => set("registeredTo", event.target.value)}
          />
        </div>
      </div>
    </>
  );
}

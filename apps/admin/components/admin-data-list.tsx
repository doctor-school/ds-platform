"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Label, NativeSelect, Switch } from "@ds/design-system";
import {
  DataTable,
  FilterBar,
  type AppliedFilter,
  type DataTableColumn,
  type DataTableRecordColumn,
} from "@ds/design-system/blocks";
import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  TAXONOMY_STATUSES,
  type TaxonomyStatus,
} from "@ds/schemas";

/**
 * The BLOCK-TIER admin list composition (017-design §9.1–§9.3, EARS-16/17) — the
 * thin app glue that mounts `DataTable` + `FilterBar` + `Pagination` + `EmptyState`
 * over this app's server query state. It owns no table, no toolbar and no chip of
 * its own: everything visible here is a `@ds/design-system` block (#1578).
 *
 * It stands BESIDE `admin-list-shell.tsx` rather than replacing it. The old shell
 * is submit-driven («Применить») and hand-assembles its table; converting the five
 * feature-012 sections that mount it is EARS-20's separate deliverable under #1578.
 * Two shells is the temporary state that split buys — recorded in the PR body, not
 * a silent fork.
 *
 * Differences from the old shell that are spec, not preference:
 *   • filters apply INSTANTLY — the text field debounces inside `FilterBar`
 *     (≈400ms) and every facet fires on change; there is no submit control;
 *   • the applied set renders as removable chips with «Сбросить всё»;
 *   • the whole ROW opens the record, so a single-action list gets no «Действия»
 *     column — the callers here all have exactly one action;
 *   • below `md` the rows become record cards, so a phone never scrolls sideways.
 */

export interface AdminDataListQueryState<Status extends string = TaxonomyStatus> {
  q: string;
  status: Status | "";
  includeRetired: boolean;
  page: number;
  pageSize: number;
}

/** Typed at `never` so one constant seeds any status vocabulary (`never | ""` is `""`). */
export const ADMIN_DATA_LIST_INITIAL_QUERY: AdminDataListQueryState<never> = {
  q: "",
  status: "",
  includeRetired: false,
  page: 1,
  pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
};

export function AdminDataList<Row, Status extends string = TaxonomyStatus>({
  title,
  description,
  notice,
  createHref,
  createLabel,
  statusLabels = {} as Record<Status, string>,
  statuses,
  searchable = true,
  searchLabel,
  searchPlaceholder,
  filterable = true,
  extraFilters,
  extraApplied = [],
  caption,
  record,
  columns,
  rows,
  getRowKey,
  total,
  isLoading,
  error,
  query,
  onQueryChange,
  rowHref,
  emptyTitle,
  emptyDescription,
  testId,
}: {
  title: string;
  description: string;
  /** A standing fact about the surface (e.g. «справочник только для чтения»). */
  notice?: ReactNode;
  createHref?: string;
  createLabel?: string;
  /**
   * RU label per lifecycle state — this composition renders no domain vocabulary.
   * Omitted only by a surface with no lifecycle at all (`filterable={false}`).
   */
  statusLabels?: Record<Status, string>;
  /** The lifecycle this resource actually has; defaults to the 012 taxonomy triple. */
  statuses?: readonly Status[];
  /** Whether the list route accepts free-text `q`. */
  searchable?: boolean;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** Whether the resource has a lifecycle to filter by at all. */
  filterable?: boolean;
  /** Resource-specific facet controls, rendered inside the same bar. */
  extraFilters?: ReactNode;
  /** Chips for the resource-specific facets — the bar cannot know their labels. */
  extraApplied?: AppliedFilter[];
  caption: string;
  record: DataTableRecordColumn<Row>;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  total: number;
  isLoading: boolean;
  error?: string | null;
  query: AdminDataListQueryState<Status>;
  onQueryChange: (next: AdminDataListQueryState<Status>) => void;
  /**
   * Omitted by a list whose records have no detail route — the Минздрав book
   * (EARS-19) is read-only end to end, so its rows are inert by design rather
   * than by an unfinished surface. `DataTable` then renders plain rows.
   */
  rowHref?: (row: Row) => string;
  emptyTitle: string;
  emptyDescription: string;
  testId: string;
}) {
  const t = useTranslations();
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));

  const applied: AppliedFilter[] = [
    ...(query.q
      ? [
          {
            id: "q",
            label: `${searchLabel ?? t("common.list.search")}: ${query.q}`,
            onRemove: () => onQueryChange({ ...query, q: "", page: 1 }),
          },
        ]
      : []),
    ...(query.status
      ? [
          {
            id: "status",
            label: statusLabels[query.status as Status],
            onRemove: () => onQueryChange({ ...query, status: "", page: 1 }),
          },
        ]
      : []),
    ...(query.includeRetired
      ? [
          {
            id: "includeRetired",
            label: t("common.list.includeRetired"),
            onRemove: () =>
              onQueryChange({ ...query, includeRetired: false, page: 1 }),
          },
        ]
      : []),
    ...extraApplied,
  ];

  const resetAll = () => {
    applied.forEach((filter) => filter.onRemove());
    onQueryChange({
      ...query,
      q: "",
      status: "",
      includeRetired: false,
      page: 1,
    });
  };

  return (
    <div>
      <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {createHref && createLabel ? (
          <Button asChild data-testid={`${testId}-create`}>
            <Link href={createHref}>{createLabel}</Link>
          </Button>
        ) : null}
      </div>

      {notice ? (
        <p
          className="mb-5 border-2 border-hairline bg-card p-4 text-sm text-muted-foreground"
          data-testid={`${testId}-notice`}
        >
          {notice}
        </p>
      ) : null}

      {/* `FilterBar` takes no arbitrary DOM props, so the e2e handle lives on the
          wrapper rather than being smuggled into the block. */}
      <div className="mb-5" data-testid={`${testId}-filters`}>
        <FilterBar
          applyMode="instant"
          label={t("common.list.filtersLabel")}
          search={
            searchable
              ? {
                  value: query.q,
                  onCommit: (value: string) =>
                    onQueryChange({ ...query, q: value.trim(), page: 1 }),
                  label: searchLabel ?? t("common.list.search"),
                  placeholder:
                    searchPlaceholder ?? t("common.list.searchPlaceholder"),
                }
              : undefined
          }
          applied={applied}
          appliedLabel={t("common.list.appliedLabel")}
          removeFilterLabel={t("common.list.removeFilter")}
          onResetAll={applied.length > 0 ? resetAll : undefined}
          resetLabel={t("common.list.resetAll")}
          isBusy={isLoading}
          busyLabel={t("common.list.busy")}
          resultCount={
            <span data-testid={`${testId}-total`}>
              {t("common.list.found", { total })}
            </span>
          }
        >
          {extraFilters}
          {filterable ? (
            <>
              <div className="flex flex-col gap-1.5 sm:w-56">
                <Label htmlFor={`${testId}-status`}>
                  {t("common.list.status")}
                </Label>
                <NativeSelect
                  id={`${testId}-status`}
                  value={query.status}
                  data-testid={`${testId}-status`}
                  onChange={(event) =>
                    onQueryChange({
                      ...query,
                      status: event.target.value as Status | "",
                      page: 1,
                    })
                  }
                >
                  <option value="">{t("common.list.statusAny")}</option>
                  {(
                    statuses ??
                    (TAXONOMY_STATUSES as readonly string[] as readonly Status[])
                  ).map((status) => (
                    <option key={status} value={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex items-center">
                <Switch
                  id={`${testId}-include-retired`}
                  checked={query.includeRetired}
                  data-testid={`${testId}-include-retired`}
                  onChange={(event) =>
                    onQueryChange({
                      ...query,
                      includeRetired: event.target.checked,
                      page: 1,
                    })
                  }
                >
                  {t("common.list.includeRetired")}
                </Switch>
              </div>
            </>
          ) : null}
        </FilterBar>
      </div>

      <div data-testid={`${testId}-table`}>
        <DataTable<Row>
          caption={caption}
          record={record}
          columns={columns}
          rows={rows}
          getRowKey={getRowKey}
          rowHref={rowHref}
          isLoading={isLoading}
          error={
            error ? (
              <span
                className="text-sm text-destructive"
                data-testid={`${testId}-error`}
              >
                {error}
              </span>
            ) : undefined
          }
          isFiltered={applied.length > 0}
          emptyNoRecords={{
            title: emptyTitle,
            description: emptyDescription,
            action:
              createHref && createLabel ? (
                <Button asChild size="sm">
                  <Link href={createHref}>{createLabel}</Link>
                </Button>
              ) : undefined,
          }}
          emptyNoResults={{
            title: t("common.list.noResultsTitle"),
            description: t("common.list.noResultsDescription"),
            action: (
              <Button variant="outline" size="sm" onClick={resetAll}>
                {t("common.list.resetAll")}
              </Button>
            ),
          }}
          pagination={{
            page: query.page,
            pageCount,
            onPageChange: (page: number) => onQueryChange({ ...query, page }),
            navLabel: t("common.list.paginationNav"),
            previousLabel: t("common.list.previous"),
            nextLabel: t("common.list.next"),
            pageLabel: (page: number) =>
              t("common.list.pageLabel", { page }),
            readout: (
              <span data-testid={`${testId}-page`}>
                {t("common.list.pageReadout", {
                  page: query.page,
                  pages: pageCount,
                })}
              </span>
            ),
            isLoading,
          }}
        />
      </div>
    </div>
  );
}

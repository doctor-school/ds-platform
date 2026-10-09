"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { Label } from "../primitives/label";
import { NativeSelect } from "../primitives/native-select";
import { Skeleton } from "../primitives/skeleton";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { Pagination, type PaginationProps } from "./pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

/**
 * `<DataTable>` (#1578, owner Stage-A pick В+Б) — the owned operator-list block that
 * replaces the hand-composed `apps/admin/components/admin-list-shell.tsx` table.
 *
 * It wraps the adopted shadcn/ui `Table` markup (`./table`, MIT) and owns the three
 * things the raw markup cannot:
 *
 * 1. THE COLUMN CONTRACT. Width is DECLARED per column, never inferred from content
 *    (Primer DataTable `width`; React Aria `width`/`minWidth`), so the same list does
 *    not re-lay itself on every page of data. Alignment is declared (`end` for numeric,
 *    so figures scan as a column) and so is overflow: a long non-title cell ellipses
 *    AND keeps the full value reachable through the native `title` attribute — a cut
 *    string with no way back to the full value is the defect, not the ellipsis
 *    (Carbon; React Aria's resizable-table CSS).
 * 2. THE RECORD ROW. The primary column is a two-part record cell (Carbon's xl row):
 *    the title WRAPS in full and a muted context line sits under it, so a long RU
 *    taxonomy name is never truncated. Below `md` (768px) the grid is
 *    replaced by stacked record CARDS — the same data, labelled — so a phone NEVER
 *    scrolls horizontally and no column silently leaves the screen.
 * 3. THE STATE SET. `loading` (skeleton rows under an already-drawn header) / `error` /
 *    `empty — no records` / `empty — no results for the current filters` / `populated`,
 *    plus the paginated footer. The two empty situations are two `EmptyState` variants
 *    routed by `isFiltered`, never one collapsed string, and the empty state NEVER
 *    renders while `isLoading` (a "нет записей" line that flips to content erodes
 *    trust — NN/g).
 *
 * ROW ACTIVATION (owner pick 2): a single-action list has NO «Действия» column — the
 * whole row opens the record. That is this prop (`rowHref` / `onRowClick`), never a
 * per-app hack: the record cell carries a REAL link/button so assistive tech gets the
 * semantics and the keyboard gets a focus ring, and its stretched overlay makes the
 * whole row a click target with a hover cue (ADR-0013 §7). An actions column is
 * rendered ONLY when `actions` is supplied, i.e. when a row genuinely has ≥2 actions.
 *
 * SERVER SORT (044 EARS-22, owner Stage-A pick S1, #2316 issuecomment-6077817101):
 * a column opts in with a `sortKey`; the table is then CONTROLLED through `sort` +
 * `onSortChange`. A sortable header is a real `<button>` inside `<th aria-sort>`:
 * every sortable header always shows a muted double arrow, the active one shows a
 * single direction arrow in the `primary-action` accent; the first click asks for
 * ascending, a click on the active column reverses it, and another header replaces
 * it — there is always exactly one sort, never a cleared one. The body cells of the
 * sorted column sit on the faint `table-sorted` surface (the header keeps no fill);
 * `headerDetail` stacks a smaller qualifier under a header title. Below `md` the cards
 * have no headers, so `sortSelect` renders a «Сортировка» select (field × direction)
 * over the same contract. The block orders nothing itself: the rows arrive already
 * ordered by the server, which is why `@tanstack/react-table` is still NOT a
 * dependency — a client-side engine would manage an array we already hold. shadcn's
 * TanStack `DataTable` recipe stays the upgrade path for client-side column ops
 * (resize, hide, multi-sort, batch selection).
 *
 * Presentation only — every string is app-supplied (no i18n inside the package).
 */

export type DataTableAlign = "start" | "end";

/** How a cell behaves when its value outgrows the declared width. */
export type DataTableOverflow = "ellipsis" | "wrap";

export interface DataTableColumn<Row> {
  /** Stable column id (also the React key). */
  key: string;
  /** Column header copy (app-supplied, localized) — rendered as `<th scope="col">`. */
  header: string;
  /**
   * DECLARED width. Omitted = the column absorbs the remainder. Two contracts:
   * PERCENT (`"20%"`) — the grid always fits its frame and shares it out; ABSOLUTE
   * (`"12rem"`, `"180px"`) — sized to the column's content. When EVERY track (record
   * + columns, no actions column) is absolute, the table's `min-width` is their sum
   * and the headers stay on one line: a grid wider than its frame scrolls inside the
   * keyboard-focusable region of `Table` instead of squeezing the columns (#2357).
   */
  width?: string;
  /** `end` for numeric columns so figures scan as a column. */
  align?: DataTableAlign;
  /** Default `ellipsis` — pair it with `fullValue` so nothing is unreachable. */
  overflow?: DataTableOverflow;
  /** Cell body. */
  render: (row: Row) => React.ReactNode;
  /**
   * Plain-text full value, put on the cell's `title`. REQUIRED in spirit for any
   * `ellipsis` column carrying free text — it is the "the full value stays
   * reachable" half of the truncation rule.
   */
  fullValue?: (row: Row) => string;
  /** Keep this column off the mobile record card (rarely right — default false). */
  hideOnCard?: boolean;
  /**
   * Opt-in server sort: the key `onSortChange` reports for this column. Omitted =
   * a plain, non-sortable header (byte-identical to a table without sorting).
   */
  sortKey?: string;
  /**
   * A short qualifier under the header title — a second, smaller line in the
   * header (e.g. «день 23.04» under «Присутствие»). The header still reads as one
   * label «header · detail» (accessible name, card term, sort-select option).
   */
  headerDetail?: string;
}

export type DataTableSortDirection = "asc" | "desc";

/** The one active server sort (EARS-22): a column's `sortKey` and a direction. */
export interface DataTableSort {
  key: string;
  direction: DataTableSortDirection;
}

/** The below-`md` «Сортировка» select — copy is app-supplied. */
export interface DataTableSortSelect {
  /** Visible field label («Сортировка»). */
  label: string;
  /** One option per sortable column × direction, e.g. «ФИО — от А до Я». */
  optionLabel: (
    column: { key: string; header: string },
    direction: DataTableSortDirection,
  ) => string;
}

export interface DataTableRecordColumn<Row> {
  /** Header copy for the primary record column. */
  header: string;
  /** Declared width for the record column. */
  width?: string;
  /** Line 1 — the human-readable record identifier, wrapping in full. */
  title: (row: Row) => React.ReactNode;
  /** Line 2 — muted context (parent, code, owner). Optional. */
  context?: (row: Row) => React.ReactNode;
  /** Accessible name for the row-activation control (plain text). */
  label: (row: Row) => string;
  /** Opt-in server sort for the record column (see `DataTableColumn.sortKey`). */
  sortKey?: string;
}

export interface DataTableProps<Row> {
  /** The primary title-plus-context record column (always first, always present). */
  record: DataTableRecordColumn<Row>;
  /** The remaining declared columns, in operator-importance order. */
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  /** Accessible name for the table (`<caption>`, visually hidden). */
  caption: string;
  /** Row activation — a link target (preferred) or a callback. Omit for inert rows. */
  rowHref?: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  /** Renders a trailing actions column — ONLY for rows with ≥2 actions. */
  actions?: (row: Row) => React.ReactNode;
  /** Header copy for that actions column (visually hidden, still announced). */
  actionsHeader?: string;
  isLoading?: boolean;
  /** Number of skeleton rows drawn while loading. */
  loadingRowCount?: number;
  /** Error node (an alert) — replaces the body; never an empty state. */
  error?: React.ReactNode;
  /** True when any filter is applied — routes WHICH empty state is shown. */
  isFiltered?: boolean;
  emptyNoRecords: Omit<EmptyStateProps, "variant">;
  emptyNoResults: Omit<EmptyStateProps, "variant">;
  pagination?: PaginationProps;
  /** The active server sort — controlled; required for any `sortKey` to render. */
  sort?: DataTableSort;
  /** Called with the sort a header click / the select asks for. */
  onSortChange?: (next: DataTableSort) => void;
  /** Renders the below-`md` «Сортировка» select over the sortable columns. */
  sortSelect?: DataTableSortSelect;
  className?: string;
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

/** Square-cap 16px strokes, `currentColor` — the DS inline-icon convention. */
/** A header as one plain label: «title · detail» (accessible name, card term, select). */
function headerText(header: string, detail: string | undefined): string {
  return detail ? `${header} · ${detail}` : header;
}

function SortIcon({ state }: { state: DataTableSortDirection | "none" }) {
  const paths =
    state === "asc"
      ? ["M8 13V3.5", "M3.5 7.5 8 3l4.5 4.5"]
      : state === "desc"
        ? ["M8 3v9.5", "M3.5 8.5 8 13l4.5-4.5"]
        : ["M4.5 6.5 8 3l3.5 3.5", "M4.5 9.5 8 13l3.5-3.5"];
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      data-sort-icon={state}
      className={cn(
        "shrink-0",
        state === "none" ? "text-muted-2" : "text-primary-action",
      )}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const alignClass = (align: DataTableAlign | undefined) =>
  align === "end" ? "text-right tabular-nums" : "text-left";

/** An absolute CSS length (`16rem`, `180px`) — never a share of the frame. */
const ABSOLUTE_LENGTH = /^\s*(\d*\.?\d+)(rem|px|em|ch)\s*$/;

/**
 * The table's `min-width` when every track declares an absolute width: their sum
 * (one unit → a plain length, mixed units → `calc()`). `undefined` otherwise — a
 * percent or undeclared track keeps the fit-the-frame contract.
 */
export function absoluteGridMinWidth(
  widths: Array<string | undefined>,
): string | undefined {
  const lengths = widths.map((width) =>
    width === undefined ? null : ABSOLUTE_LENGTH.exec(width),
  );
  if (lengths.length === 0 || lengths.some((match) => !match)) return undefined;
  const matches = lengths as RegExpExecArray[];
  const units = new Set(matches.map((match) => match[2]));
  if (units.size === 1) {
    const sum = matches.reduce((total, match) => total + Number(match[1]), 0);
    return `${Number(sum.toFixed(4))}${matches[0]?.[2] ?? ""}`;
  }
  return `calc(${matches.map((match) => `${match[1]}${match[2]}`).join(" + ")})`;
}

export function DataTable<Row>({
  record,
  columns,
  rows,
  getRowKey,
  caption,
  rowHref,
  onRowClick,
  actions,
  actionsHeader,
  isLoading = false,
  loadingRowCount = 5,
  error,
  isFiltered = false,
  emptyNoRecords,
  emptyNoResults,
  pagination,
  sort,
  onSortChange,
  sortSelect,
  className,
}: DataTableProps<Row>) {
  const sortSelectId = React.useId();
  const sortColumns =
    sort && onSortChange
      ? [
          ...(record.sortKey
            ? [{ key: record.sortKey, header: record.header }]
            : []),
          ...columns.flatMap((column) =>
            column.sortKey
              ? [
                  {
                    key: column.sortKey,
                    header: headerText(column.header, column.headerDetail),
                  },
                ]
              : [],
          ),
        ]
      : [];

  /**
   * A header cell: plain copy, or — for an opted-in column of a controlled table —
   * the S1 sort button inside `<th aria-sort>`. The button fills the cell (the
   * cell's padding moves onto it) so the whole header is the click target.
   */
  const head = (
    key: string,
    header: string,
    detail: string | undefined,
    sortKey: string | undefined,
    align: DataTableAlign | undefined,
    className: string | undefined,
  ) => {
    const active = Boolean(sort && sort.key === sortKey);
    const title = detail ? (
      // Two lines — the title, and under it the smaller qualifier.
      <span className="flex min-w-0 flex-col leading-tight">
        <span>{header}</span>
        <span
          className={cn(
            "text-xs font-bold normal-case tracking-normal",
            active ? "text-tint-foreground" : "text-muted-foreground",
          )}
        >
          {detail}
        </span>
      </span>
    ) : (
      <span className="min-w-0">{header}</span>
    );
    if (!sortKey || !sort || !onSortChange) {
      return (
        <TableHead key={key} className={className}>
          {headerText(header, detail)}
        </TableHead>
      );
    }
    return (
      <TableHead
        key={key}
        aria-sort={active ? ARIA_SORT[sort.direction] : "none"}
        className={cn(className, "p-0")}
      >
        <button
          type="button"
          // Two stacked lines would read as «titledetail»; the name stays the
          // one label the visible text spells.
          aria-label={detail ? headerText(header, detail) : undefined}
          onClick={() =>
            onSortChange({
              key: sortKey,
              direction: active && sort.direction === "asc" ? "desc" : "asc",
            })
          }
          className={cn(
            "flex w-full items-center gap-1.5 px-3.5 py-3 font-extrabold uppercase tracking-tight hover:bg-tint focus-visible:shadow-focus focus-visible:outline-none",
            align === "end"
              ? "justify-end text-right"
              : "justify-start text-left",
            active ? "text-tint-foreground" : "text-foreground",
          )}
        >
          {title}
          <SortIcon state={active && sort ? sort.direction : "none"} />
        </button>
      </TableHead>
    );
  };
  const clickable = Boolean(rowHref || onRowClick);
  /**
   * S1: the body cells of the column the table is sorted by sit on the faint
   * `table-sorted` surface at rest (the header keeps no fill). A cell paints over
   * its row, so on a clickable row it hands the hover / pressed tint back.
   */
  const sortedCell = (sortKey: string | undefined) =>
    sortKey && sort && onSortChange && sort.key === sortKey
      ? cn(
          "bg-table-sorted",
          clickable &&
            "group-hover/row:bg-tint group-has-[:active]/row:bg-tint-pressed group-focus-within/row:bg-tint",
        )
      : undefined;
  const columnCount = 1 + columns.length + (actions ? 1 : 0);
  // An actions column declares no width (it absorbs the remainder), so a grid with
  // one is never all-absolute.
  const minWidth = actions
    ? undefined
    : absoluteGridMinWidth([record.width, ...columns.map((c) => c.width)]);
  const headClass = minWidth ? "whitespace-nowrap" : undefined;

  const activation = (row: Row) => {
    const label = record.label(row);
    // The whole row is the click target: a REAL link/button (so the semantics and
    // the keyboard focus ring are native) with a stretched transparent overlay
    // rendered as its own CHILD — a click anywhere on the row lands on the control.
    // Plain utilities only, no arbitrary values (§5 guard).
    // NO hover underline on the title — owner, 2026-08-27: «Заголовок в таблице не
    // нужно подчёркивать при наведении, покраски строки и поинтера достаточно, иначе
    // только лишний визуальный шум появляется». The row tint + `cursor-pointer` are
    // the affordance; this is a row-scoped deviation from the Link hover contract
    // (constitution → Data table / admin list).
    const overlay = <span aria-hidden="true" className="absolute inset-0" />;
    if (rowHref) {
      return (
        <a
          href={rowHref(row)}
          aria-label={label}
          className="font-bold text-foreground focus-visible:outline-none"
        >
          {record.title(row)}
          {overlay}
        </a>
      );
    }
    if (onRowClick) {
      return (
        <button
          type="button"
          aria-label={label}
          onClick={() => onRowClick(row)}
          className="text-left font-bold text-foreground focus-visible:outline-none"
        >
          {record.title(row)}
          {overlay}
        </button>
      );
    }
    return (
      <span className="font-bold text-foreground">{record.title(row)}</span>
    );
  };

  const body = () => {
    if (isLoading) {
      return Array.from({ length: loadingRowCount }).map((_, index) => (
        <TableRow key={`skeleton-${index}`}>
          {Array.from({ length: columnCount }).map((__, cell) => (
            <TableCell key={`skeleton-${index}-${cell}`}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ));
    }
    if (error) {
      return (
        <TableRow>
          <TableCell colSpan={columnCount}>{error}</TableCell>
        </TableRow>
      );
    }
    if (rows.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={columnCount} className="p-0">
            <EmptyState
              {...(isFiltered ? emptyNoResults : emptyNoRecords)}
              variant={isFiltered ? "no-results" : "no-records"}
            />
          </TableCell>
        </TableRow>
      );
    }
    return rows.map((row) => (
      <TableRow
        key={getRowKey(row)}
        data-clickable={clickable ? "true" : undefined}
        className={cn(
          "group/row relative",
          clickable &&
            "cursor-pointer hover:bg-tint has-[:active]:bg-tint-pressed focus-within:bg-tint focus-within:shadow-focus",
        )}
      >
        <TableCell className={cn("py-3.5", sortedCell(record.sortKey))}>
          <span className="block">{activation(row)}</span>
          {record.context ? (
            <span
              className={cn(
                "mt-1 block text-caption text-muted-foreground",
                clickable && "group-has-[:active]/row:text-foreground",
              )}
            >
              {record.context(row)}
            </span>
          ) : null}
        </TableCell>
        {columns.map((column) => {
          const ellipsis = (column.overflow ?? "ellipsis") === "ellipsis";
          return (
            <TableCell
              key={column.key}
              title={column.fullValue?.(row)}
              className={cn(
                alignClass(column.align),
                ellipsis && "truncate",
                sortedCell(column.sortKey),
              )}
              style={column.width ? { maxWidth: column.width } : undefined}
            >
              {column.render(row)}
            </TableCell>
          );
        })}
        {actions ? (
          <TableCell className="relative z-10 text-right">
            {actions(row)}
          </TableCell>
        ) : null}
      </TableRow>
    ));
  };

  /** Below `md` the same rows render as stacked cards — never a sideways scroll. */
  const cards = () => {
    if (isLoading) {
      return Array.from({ length: loadingRowCount }).map((_, index) => (
        <div
          key={`card-skeleton-${index}`}
          className="flex flex-col gap-2 border-2 border-border bg-card p-3.5"
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ));
    }
    if (error) return <div className="p-3.5">{error}</div>;
    if (rows.length === 0) {
      return (
        <EmptyState
          {...(isFiltered ? emptyNoResults : emptyNoRecords)}
          variant={isFiltered ? "no-results" : "no-records"}
          className="border-2 border-border bg-card"
        />
      );
    }
    return rows.map((row) => (
      <div
        key={getRowKey(row)}
        data-clickable={clickable ? "true" : undefined}
        className={cn(
          "group/row relative flex flex-col gap-2 border-2 border-border bg-card p-3.5",
          clickable &&
            "cursor-pointer hover:bg-tint has-[:active]:bg-tint-pressed focus-within:shadow-focus",
        )}
      >
        <div>
          {activation(row)}
          {record.context ? (
            <span
              className={cn(
                "mt-1 block text-caption text-muted-foreground",
                clickable && "group-has-[:active]/row:text-foreground",
              )}
            >
              {record.context(row)}
            </span>
          ) : null}
        </div>
        <dl className="flex flex-col gap-1">
          {columns
            .filter((column) => !column.hideOnCard)
            .map((column) => (
              <div key={column.key} className="flex gap-2 text-sm">
                <dt className="text-caption text-muted-foreground">
                  {headerText(column.header, column.headerDetail)}
                </dt>
                <dd className="text-sm text-foreground">
                  {column.render(row)}
                </dd>
              </div>
            ))}
        </dl>
        {actions ? <div className="relative z-10">{actions(row)}</div> : null}
      </div>
    ));
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* ≥ md — the declared column grid. */}
      <div className="hidden md:block">
        <Table
          regionLabel={caption}
          className="table-fixed"
          style={minWidth ? { minWidth } : undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col style={record.width ? { width: record.width } : undefined} />
            {columns.map((column) => (
              <col
                key={column.key}
                style={column.width ? { width: column.width } : undefined}
              />
            ))}
            {actions ? <col /> : null}
          </colgroup>
          <TableHeader>
            <TableRow>
              {head(
                "record",
                record.header,
                undefined,
                record.sortKey,
                undefined,
                headClass,
              )}
              {columns.map((column) =>
                head(
                  column.key,
                  column.header,
                  column.headerDetail,
                  column.sortKey,
                  column.align,
                  cn(alignClass(column.align), headClass),
                ),
              )}
              {actions ? (
                <TableHead className="text-right">
                  <span className="sr-only">{actionsHeader ?? "Действия"}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>{body()}</TableBody>
        </Table>
        {pagination ? <Pagination {...pagination} /> : null}
      </div>

      {/* < md — stacked record cards, no horizontal scroll ever. */}
      <div className="flex flex-col gap-3 md:hidden">
        {sortSelect && sort && onSortChange && sortColumns.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={sortSelectId}>{sortSelect.label}</Label>
            <NativeSelect
              id={sortSelectId}
              value={`${sort.key}:${sort.direction}`}
              onChange={(event) => {
                const value = event.target.value;
                const split = value.lastIndexOf(":");
                onSortChange({
                  key: value.slice(0, split),
                  direction: value.slice(split + 1) as DataTableSortDirection,
                });
              }}
            >
              {sortColumns.flatMap((column) =>
                (["asc", "desc"] as const).map((direction) => (
                  <option
                    key={`${column.key}:${direction}`}
                    value={`${column.key}:${direction}`}
                  >
                    {sortSelect.optionLabel(column, direction)}
                  </option>
                )),
              )}
            </NativeSelect>
          </div>
        ) : null}
        {cards()}
        {pagination ? (
          <Pagination {...pagination} className="border-t-0 px-0" />
        ) : null}
      </div>
    </div>
  );
}

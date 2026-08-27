"use client";

import * as React from "react";

import { cn } from "../lib/utils";
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
 * 2. THE RECORD ROW. The primary column is a two-line record cell (Carbon's xl row):
 *    the title WRAPS to at most two lines and a muted context line sits under it, so a
 *    long RU taxonomy name is never cut mid-glance. Below `md` (768px) the grid is
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
 * `@tanstack/react-table` is deliberately NOT a dependency: our lists are
 * server-queried (one page of rows arrives already ordered), so a client-side table
 * engine would manage an array we already hold. shadcn's TanStack `DataTable` recipe
 * is the documented upgrade path, taken when a list first needs client-side column ops
 * (resize, hide, multi-sort, batch selection). Recorded in the design constitution so
 * the deferral is a decision, not an untracked seam.
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
  /** DECLARED width (CSS length or %). Omitted = the column absorbs the remainder. */
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
}

export interface DataTableRecordColumn<Row> {
  /** Header copy for the primary record column. */
  header: string;
  /** Declared width for the record column. */
  width?: string;
  /** Line 1 — the human-readable record identifier, wrapping to at most 2 lines. */
  title: (row: Row) => React.ReactNode;
  /** Line 2 — muted context (parent, code, owner). Optional. */
  context?: (row: Row) => React.ReactNode;
  /** Accessible name for the row-activation control (plain text). */
  label: (row: Row) => string;
}

export interface DataTableProps<Row> {
  /** The primary two-line record column (always first, always present). */
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
  className?: string;
}

const alignClass = (align: DataTableAlign | undefined) =>
  align === "end" ? "text-right tabular-nums" : "text-left";

/**
 * The at-most-two-lines record title. `line-clamp-2` is a first-class Tailwind
 * utility — no arbitrary value, so the §5 arbitrary-value guard stays green.
 */
const CLAMP_2 = "line-clamp-2";

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
  className,
}: DataTableProps<Row>) {
  const clickable = Boolean(rowHref || onRowClick);
  const columnCount = 1 + columns.length + (actions ? 1 : 0);

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
    const overlay = (
      <span aria-hidden="true" className="absolute inset-0" />
    );
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
          "relative",
          clickable &&
            "cursor-pointer hover:bg-tint focus-within:bg-tint focus-within:shadow-focus",
        )}
      >
        <TableCell className="py-3.5">
          <span className={cn("block", CLAMP_2)}>{activation(row)}</span>
          {record.context ? (
            <span className="mt-1 block text-caption text-muted-foreground">
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
          "relative flex flex-col gap-2 border-2 border-border bg-card p-3.5",
          clickable && "cursor-pointer hover:bg-tint focus-within:shadow-focus",
        )}
      >
        <div>
          {activation(row)}
          {record.context ? (
            <span className="mt-1 block text-caption text-muted-foreground">
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
                  {column.header}
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
        <Table>
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
              <TableHead>{record.header}</TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={alignClass(column.align)}
                >
                  {column.header}
                </TableHead>
              ))}
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
        {cards()}
        {pagination ? (
          <Pagination {...pagination} className="border-t-0 px-0" />
        ) : null}
      </div>
    </div>
  );
}

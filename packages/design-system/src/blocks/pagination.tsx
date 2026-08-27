"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import { interactiveBase } from "../primitives/interactive-base";

/**
 * `<Pagination>` (#1578, owner pick П1 — numbered pages) — the data-table footer:
 * a range/total readout plus a `<nav>` carrying previous / next and the page
 * numbers with ellipses.
 *
 * Adopted from official shadcn/ui `Pagination` (MIT — Copyright (c) 2023 shadcn;
 * https://ui.shadcn.com/docs/components/pagination): its
 * `PaginationLink` / `PaginationPrevious` / `PaginationNext` / `PaginationEllipsis`
 * markup contract, re-skinned to DS tokens. Upstream's anchors become real
 * `<button>`s because our lists page through client query state, not URLs.
 *
 * The GOV.UK rules are the component's behaviour, not the page's:
 *   • one page of content → the whole control does not render;
 *   • NO previous control on the first page, NO next control on the last;
 *   • `<nav aria-label>` + `aria-current="page"` on exactly one number;
 *   • never a focusable disabled-looking control that does nothing.
 * All copy is app-supplied (RU lives in the app), so the block stays i18n-free.
 *
 * Narrow viewports are the block's problem too: below `sm` it collapses to the GOV.UK
 * mobile shape — first / current / last with ellipses — and the list may wrap. The
 * collapse is CSS on one rendered sequence, never a second nav, so `aria-current` stays
 * unique, the dropped numbers are `display:none` (out of the tab order), and previous /
 * next remain reachable at every width.
 */

export interface PaginationProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** Current 1-based page. */
  page: number;
  /** Total number of pages. `<= 1` renders nothing at all. */
  pageCount: number;
  /** Page change request — the surface re-queries. */
  onPageChange: (page: number) => void;
  /** Accessible name for the `<nav>` landmark (app-supplied, e.g. «Страницы»). */
  navLabel: string;
  /** Visible previous/next copy (app-supplied, e.g. «Назад» / «Вперёд»). */
  previousLabel: string;
  nextLabel: string;
  /** Per-number accessible label builder, e.g. `(n) => \`Страница ${n}\``. */
  pageLabel: (page: number) => string;
  /** Optional range readout node («Показаны 1–20 из 137»). */
  readout?: React.ReactNode;
  /** Controls are inert while the next page is in flight. */
  isLoading?: boolean;
  /** Pages rendered either side of the current one (shrink on narrow screens). */
  siblingCount?: number;
}

/** The visible page sequence: first, last, current ± siblings, `null` = ellipsis. */
export function buildPageItems(
  page: number,
  pageCount: number,
  siblingCount = 1,
): Array<number | null> {
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - siblingCount; p <= page + siblingCount; p += 1) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const items: Array<number | null> = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) items.push(null);
    items.push(p);
    previous = p;
  }
  return items;
}

/**
 * One rendered item plus the widths it is visible at. Page numbers always render at
 * `sm` and up (`showNarrow` decides the narrow shape); an ellipsis can belong to one
 * shape only — the narrow collapse skips runs the wide sequence spells out in full.
 */
export type PaginationItem =
  | { kind: "page"; page: number; showNarrow: boolean }
  | { kind: "ellipsis"; showNarrow: boolean; showWide: boolean };

/**
 * The wide sequence (current ± siblings) merged with the narrow one (`siblingCount` 0 —
 * first / current / last), each item flagged with the widths it shows at. The narrow set
 * is always a subset of the wide one, so a single DOM sequence serves both shapes.
 */
export function buildResponsivePageItems(
  page: number,
  pageCount: number,
  siblingCount = 1,
): PaginationItem[] {
  const isPage = (p: number | null): p is number => p !== null;
  const wide = buildPageItems(page, pageCount, siblingCount).filter(isPage);
  const narrow = buildPageItems(page, pageCount, 0).filter(isPage);
  const inNarrow = new Set(narrow);

  const items: PaginationItem[] = [];
  wide.forEach((current, index) => {
    if (index > 0) {
      const previous = wide[index - 1]!;
      const showWide = current - previous > 1;
      // Exactly one narrow ellipsis per narrow gap: it is emitted at the boundary right
      // after the narrow item that opens the gap, so a run of dropped numbers collapses
      // into a single «…» rather than one per hidden number.
      const nextNarrow = narrow.find((p) => p >= current);
      const showNarrow =
        inNarrow.has(previous) && nextNarrow !== undefined && nextNarrow - previous > 1;
      if (showWide || showNarrow) items.push({ kind: "ellipsis", showNarrow, showWide });
    }
    items.push({ kind: "page", page: current, showNarrow: inNarrow.has(current) });
  });
  return items;
}

const stepClasses = cn(
  interactiveBase,
  "inline-flex items-center border-2 border-border bg-background px-3 py-2 text-caption font-bold text-foreground",
  "hover:border-primary hover:bg-tint focus-visible:shadow-focus",
  // ADR-0013 §7 requires a press distinct from hover. There is no darker step of
  // `tint` in the token set, so the press is the neo-brutalist nudge already set as
  // precedent by `FilterChip` — token-free, and legible on a control this small.
  "active:translate-x-0.5 active:translate-y-0.5 active:border-primary-action",
);

export function Pagination({
  page,
  pageCount,
  onPageChange,
  navLabel,
  previousLabel,
  nextLabel,
  pageLabel,
  readout,
  isLoading = false,
  siblingCount = 1,
  className,
  ...rest
}: PaginationProps) {
  // GOV.UK: "do not show pagination if there's only one page of content".
  if (pageCount <= 1) return null;

  const items = buildResponsivePageItems(page, pageCount, siblingCount);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t-2 border-border px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      {...rest}
    >
      {readout ? (
        <p className="text-caption text-muted-foreground">{readout}</p>
      ) : (
        <span />
      )}
      <nav aria-label={navLabel} aria-busy={isLoading || undefined} className="min-w-0">
        {/* `flex-wrap` is the floor under the collapse: even at the narrowest shape the
            list re-flows onto a second line instead of pushing the page sideways. */}
        <ul className="flex list-none flex-wrap items-center justify-center gap-1 sm:justify-end">
          {/* No previous control at all on the first page — not a dead one. */}
          {page > 1 ? (
            <li>
              <button
                type="button"
                className={stepClasses}
                disabled={isLoading}
                onClick={() => onPageChange(page - 1)}
              >
                {previousLabel}
              </button>
            </li>
          ) : null}
          {items.map((item, index) =>
            item.kind === "ellipsis" ? (
              <li
                key={`gap-${index}`}
                aria-hidden="true"
                className={cn(
                  "px-2 text-caption text-muted-foreground",
                  item.showNarrow ? (item.showWide ? undefined : "sm:hidden") : "hidden sm:block",
                )}
              >
                …
              </li>
            ) : (
              <li key={item.page} className={item.showNarrow ? undefined : "hidden sm:block"}>
                <button
                  type="button"
                  aria-label={pageLabel(item.page)}
                  aria-current={item.page === page ? "page" : undefined}
                  disabled={isLoading}
                  onClick={() => onPageChange(item.page)}
                  className={cn(
                    interactiveBase,
                    "inline-flex min-w-11 items-center justify-center border-2 px-3 py-2 text-caption focus-visible:shadow-focus",
                    item.page === page
                      ? "border-primary-action bg-primary-surface font-extrabold text-primary-surface-foreground"
                      : cn(
                          "border-border bg-background font-bold text-primary-action hover:border-primary hover:bg-tint",
                          // See `stepClasses`: the press is the FilterChip nudge, since
                          // the token set has no darker step of `tint` (ADR-0013 §7).
                          "active:translate-x-0.5 active:translate-y-0.5 active:border-primary-action",
                        ),
                  )}
                >
                  {item.page}
                </button>
              </li>
            ),
          )}
          {/* …and no next control on the last page. */}
          {page < pageCount ? (
            <li>
              <button
                type="button"
                className={stepClasses}
                disabled={isLoading}
                onClick={() => onPageChange(page + 1)}
              >
                {nextLabel}
              </button>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}

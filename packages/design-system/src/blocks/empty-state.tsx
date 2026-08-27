import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `<EmptyState>` (#1578) — the "an empty collection is a MESSAGE, not an absence"
 * block (NN/g, empty-state interface design). Adopted structural seam: official
 * shadcn/ui `DataTable`'s empty row (MIT) — a single centred body region that keeps
 * the column header row drawn so the surface does not jump — with the copy and the
 * action layered on top.
 *
 * THE CONTRACT THAT MAKES IT A BLOCK: the two empty situations are two distinct
 * `variant`s, never one collapsed `emptyLabel` string (which is exactly the defect
 * in the hand-composed `apps/admin/components/admin-list-shell.tsx`):
 *   • `no-records`  — the section holds nothing yet. Gets the PRIMARY create action.
 *   • `no-results`  — records exist, the current filters matched none. Gets a QUIET
 *                     secondary way out («Сбросить фильтры»); offering "create" as
 *                     the answer to a failed search mis-reads the operator's intent.
 *
 * `error` is a different unit (alert), and the LOADING moment belongs to the
 * skeleton — a "нет записей" line that later flips to content erodes trust (NN/g),
 * so `DataTable` never renders this while `isLoading`.
 *
 * Presentation only: every string and the action are app-supplied (no i18n in the
 * package). No client hooks → server-safe, no `"use client"`.
 */

export type EmptyStateVariant = "no-records" | "no-results";

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** WHICH empty situation this is — the two are never one string. */
  variant: EmptyStateVariant;
  /** Heading, app-supplied and localized («Направлений пока нет»). */
  title: React.ReactNode;
  /** One explanatory line; for `no-results`, name what was applied. */
  description?: React.ReactNode;
  /**
   * At most one action. `no-records` → the primary create `Button`;
   * `no-results` → a secondary «Сбросить фильтры».
   */
  action?: React.ReactNode;
}

export function EmptyState({
  variant,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      data-variant={variant}
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
      {...rest}
    >
      <p className="text-base font-bold text-foreground">{title}</p>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

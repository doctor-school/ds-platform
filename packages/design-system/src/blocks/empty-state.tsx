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
 * 028 (#1966) EXTENDS the same unit to the three NON-EMPTY absences a document
 * surface has to show — `loading`, `error`, `not-found` — so a shell renders ONE
 * component for "there is nothing to read right now" instead of a bare host 404/500
 * (028-design.md → dataState). They are separate variants, not a re-used
 * `no-records`, because the reader's next move differs in each:
 *   • `loading`    — the wait. Skeleton bars, `role="status"` + `aria-busy`, and the
 *                    `title` carried as the screen-reader announcement only: a
 *                    visible "нет записей" line that later flips to content erodes
 *                    trust (NN/g), which is why `DataTable` still never renders the
 *                    two EMPTY variants while loading.
 *   • `error`      — the fetch failed. A danger-framed alert (`role="alert"`) whose
 *                    action is a RETRY; the content may well exist.
 *   • `not-found`  — the address resolves to nothing. No retry — the way out is a
 *                    link back to the collection.
 *
 * Presentation only: every string and the action are app-supplied (no i18n in the
 * package). No client hooks → server-safe, no `"use client"`.
 */

export type EmptyStateVariant =
  | "no-records"
  | "no-results"
  | "loading"
  | "error"
  | "not-found";

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** WHICH empty situation this is — the two are never one string. */
  variant: EmptyStateVariant;
  /**
   * Heading, app-supplied and localized («Направлений пока нет»). Omit it ONLY
   * on `not-found`, and only when an ancestor surface already prints this
   * state's headline (the `legal-document` poster hero renders it as the page
   * `h1`): printing it again would draw the same sentence twice on screen AND
   * announce the state's heading twice to assistive tech.
   */
  title?: React.ReactNode;
  /** One explanatory line; for `no-results`, name what was applied. */
  description?: React.ReactNode;
  /**
   * At most one action. `no-records` → the primary create `Button`;
   * `no-results` → a secondary «Сбросить фильтры»; `error` → «Повторить»;
   * `not-found` → the link back to the collection. `loading` takes none.
   */
  action?: React.ReactNode;
}

/** How many skeleton lines the `loading` variant draws (canvas: heading + 3 abzats). */
const LOADING_LINE_WIDTHS = [
  "w-2/5",
  "w-full",
  "w-11/12",
  "w-3/4",
  "w-full",
  "w-5/6",
] as const;

export function EmptyState({
  variant,
  title,
  description,
  action,
  className,
  ...rest
}: EmptyStateProps) {
  if (variant === "loading") {
    // The wait is not a message: the copy exists for assistive tech only, so a
    // sighted reader never sees a sentence that a moment later becomes content.
    return (
      <div
        data-variant={variant}
        role="status"
        aria-busy="true"
        className={cn("flex flex-col gap-3.5", className)}
        {...rest}
      >
        <span className="sr-only">{title}</span>
        {LOADING_LINE_WIDTHS.map((width, index) => (
          <span
            key={width + String(index)}
            aria-hidden="true"
            className={cn(
              "block h-3.5 animate-live-pulse bg-hairline",
              index === 0 ? "h-5" : undefined,
              width,
            )}
          />
        ))}
      </div>
    );
  }

  if (variant === "error") {
    // A failed fetch is an ALERT, not an absence — danger frame, assertive role,
    // and the action is a retry because the content probably still exists.
    return (
      <div
        data-variant={variant}
        role="alert"
        className={cn(
          "flex flex-wrap items-center gap-4 border-2 border-destructive bg-destructive-tint px-6 py-6",
          className,
        )}
        {...rest}
      >
        <div className="min-w-50 flex-1">
          <p className="text-sm font-bold text-foreground">{title}</p>
          {description ? (
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex-none">{action}</div> : null}
      </div>
    );
  }

  if (variant === "not-found") {
    // The address resolved to nothing. Left-aligned inside the reading column —
    // it replaces the document, so it reads as prose, not as a centred plate —
    // and the only way out is the link back to the collection.
    return (
      <div
        data-variant={variant}
        className={cn("max-w-prose", className)}
        {...rest}
      >
        {title ? (
          <p className="text-base font-bold text-foreground">{title}</p>
        ) : null}
        {description ? (
          <p
            className={cn(
              "text-base leading-relaxed font-semibold text-muted-foreground",
              title ? "mt-3" : undefined,
            )}
          >
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    );
  }

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

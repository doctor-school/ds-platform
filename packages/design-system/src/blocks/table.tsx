import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `Table` family — ADOPTED VERBATIM from official shadcn/ui `table.tsx`
 * (https://ui.shadcn.com/docs/components/table), MIT licence:
 *
 *   MIT License — Copyright (c) 2023 shadcn
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction. The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of
 *   the Software.
 *
 * Structure is upstream's (`Table` / `TableHeader` / `TableBody` / `TableFooter` /
 * `TableRow` / `TableHead` / `TableCell` / `TableCaption`, a plain semantic
 * `<table>` with NO Radix dependency); only the classes are re-skinned to DS
 * tokens per ADR-0013 §7 — square `radius-base`, the 2px structural `border`,
 * `accent` header row, `tint` row hover, `muted-foreground` secondary copy.
 *
 * This is the low-level markup tier. The column contract, the states and the
 * footer belong to the owned `DataTable` block (`./data-table`), which is what
 * product surfaces consume — an app composing raw `<Table>` rows by hand is the
 * `primitives-first` violation `DataTable` exists to close (#1578).
 */

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="w-full overflow-x-auto border-2 border-border bg-card">
    <table
      ref={ref}
      className={cn("w-full caption-bottom border-collapse text-sm", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("border-b-2 border-border bg-accent", className)}
    {...props}
  />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn(className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t-2 border-border bg-accent font-bold", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-hairline transition-colors last:border-0",
      className,
    )}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, scope = "col", ...props }, ref) => (
  <th
    ref={ref}
    scope={scope}
    className={cn(
      "px-3.5 py-3 text-left align-middle text-caption font-extrabold uppercase tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-3.5 py-3 align-middle text-foreground", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-3 text-caption text-muted-foreground", className)}
    {...props}
  />
));
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};

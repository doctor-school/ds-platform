import type { CongressRosterRow } from "@ds/schemas";
import { formatMskDateTime } from "./msk";

/**
 * 044 EARS-21/25 — the pure projection behind the congress roster screen
 * (`app/events/[id]/roster/page.tsx`). The page is a thin `AdminDataList` mount;
 * what it shows per row is decided here, so the Node-only unit tier can pin it.
 *
 * The columns follow EARS-25 exactly. № is a row COUNTER over the server's
 * paging, not a stored value: it carries no sort and no filter.
 */
export const CONGRESS_ROSTER_COLUMNS = [
  "number",
  "fullName",
  "specialtyName",
  "workplace",
  "city",
  "region",
  "phone",
  "email",
  "registeredAt",
  "confirmationMailStatus",
] as const;
export type CongressRosterColumn = (typeof CONGRESS_ROSTER_COLUMNS)[number];

/** The data cells — every roster column except the № counter. */
export type CongressRosterCells = Record<
  Exclude<CongressRosterColumn, "number">,
  string
>;

/** № for the `index`-th row of the given server page — continuous across pages. */
export function congressRosterRowNumber(
  coordinates: { page: number; pageSize: number },
  index: number,
): number {
  return (coordinates.page - 1) * coordinates.pageSize + index + 1;
}

/**
 * One row as display strings. Every answer-derived cell the read model returns
 * `null` for (EARS-16: a platform-origin registration carries no answers and the
 * profile has no value) renders EMPTY — the roster never invents a placeholder
 * the registrar could mistake for data.
 */
export function congressRosterCells(
  row: CongressRosterRow,
  mailStatusLabel: (status: "sent" | "failed") => string,
): CongressRosterCells {
  return {
    fullName: row.fullName,
    specialtyName: row.specialtyName ?? "",
    workplace: row.workplace ?? "",
    city: row.city ?? "",
    region: row.region ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    registeredAt: formatMskDateTime(row.registeredAt),
    confirmationMailStatus: row.confirmationMailStatus
      ? mailStatusLabel(row.confirmationMailStatus)
      : "",
  };
}

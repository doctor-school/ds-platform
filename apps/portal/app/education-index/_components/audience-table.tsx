"use client";

import { DataTable, type DataTableColumn } from "@ds/design-system/blocks";

import { cabinet, type AudienceRow } from "@/lib/education-index-demo/fixtures";

import { formatThousands } from "./format";

/**
 * 045 EARS-9 — the cabinet audience table: exactly the 5 fixture rows, composed
 * from the DS `DataTable` block (adopted shadcn `Table`), whose below-`md`
 * stacked record cards are the canvas «390 · аудитория карточками» unit. A
 * client boundary only because the block takes render functions. The list is
 * fixed — no pagination, no row activation (EARS-10: nothing wires further).
 */
const COLUMNS: DataTableColumn<AudienceRow>[] = [
  {
    key: "specialty",
    header: "Специальность",
    width: "18%",
    render: (row) => row.specialty,
  },
  { key: "city", header: "Город", width: "15%", render: (row) => row.city },
  {
    key: "workplace",
    header: "Место работы",
    width: "24%",
    render: (row) => row.workplace,
  },
  {
    key: "activity",
    header: "Что делал",
    render: (row) => row.activity,
  },
];

export function AudienceTable() {
  return (
    <DataTable
      caption={`Аудитория ваших проектов: показано ${cabinet.audience.length} из ${formatThousands(cabinet.audienceTotal)}`}
      record={{
        header: "ФИО",
        width: "23%",
        title: (row) => row.name,
        label: (row) => row.name,
      }}
      columns={COLUMNS}
      rows={[...cabinet.audience]}
      getRowKey={(row) => row.name}
      emptyNoRecords={{}}
      emptyNoResults={{}}
    />
  );
}

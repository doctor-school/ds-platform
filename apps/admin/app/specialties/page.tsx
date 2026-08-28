"use client";

import { useMemo, useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { SpecialtyBook, SpecialtyRef } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";

/**
 * The Минздрав specialty book (017 EARS-19, LD-9) — READ-ONLY, and read-only all
 * the way down: no create button, no row action, no lifecycle filter, and no
 * detail route to click through to. The nomenclature is not editorial content;
 * it follows a Минздрав order, and the platform's job is to let an operator LOOK
 * something up before wiring it to a direction on the «Связи специальностей»
 * screen. An affordance that implied otherwise would promise an edit no route
 * accepts (there is deliberately no admin specialties resource — #1479).
 *
 * It reads the SAME public endpoint the doctor-facing surfaces read
 * (`GET /v1/public/specialties`), not an admin twin: one book, one projection, so
 * an operator can never be looking at a list the doctor does not see.
 *
 * That endpoint returns the WHOLE book in one response and takes no paging or `q`
 * parameters, so the search and the page window are computed here over the loaded
 * entries. This is the honest simple thing rather than a workaround: the book is
 * a few hundred closed rows that change with a ministerial order, and inventing
 * server paging for it would be an API change this slice has no reason to make.
 * Filtering matches name OR code, because the nomenclature carries near-identical
 * names that only the code tells apart.
 */
export default function SpecialtiesListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );

  const { result, query: request } = useCustom<SpecialtyBook>({
    url: "/v1/public/specialties",
    method: "get",
  });

  const entries = useMemo(() => result.data?.entries ?? [], [result.data]);

  const matched = useMemo(() => {
    const needle = query.q.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLocaleLowerCase().includes(needle) ||
        entry.code.toLocaleLowerCase().includes(needle),
    );
  }, [entries, query.q]);

  const page = matched.slice(
    (query.page - 1) * query.pageSize,
    query.page * query.pageSize,
  );

  const columns: DataTableColumn<SpecialtyRef>[] = [
    {
      key: "code",
      header: t("specialties.columns.code"),
      width: "24%",
      render: (row) => row.code,
      fullValue: (row) => row.code,
      hideOnCard: true,
    },
  ];

  return (
    <Authenticated key="specialties-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<SpecialtyRef, never>
          title={t("specialties.listTitle")}
          description={t("specialties.listDescription")}
          notice={t("specialties.readOnlyNotice")}
          searchable
          searchLabel={t("specialties.filters.search")}
          searchPlaceholder={t("specialties.filters.searchPlaceholder")}
          // The book has no lifecycle: a specialty is in the nomenclature or it
          // is not. A «Состояние» facet here would filter by a property the rows
          // do not carry.
          filterable={false}
          caption={t("specialties.tableCaption")}
          record={{
            // The record column names ONE row, so it is the singular noun —
            // «Специальность», the twin of «Название» / «Направление» on the
            // other lists. Reusing the page title here made the column header
            // read as a second page heading in the middle of the table.
            header: t("specialties.columns.name"),
            width: "76%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.name}</span>
            ),
            context: (row) => t("specialties.rowContext", { code: row.code }),
            label: (row) => `${row.name} (${row.code})`,
          }}
          columns={columns}
          rows={page}
          getRowKey={(row) => row.id}
          total={matched.length}
          isLoading={request.isLoading}
          error={request.isError ? t("specialties.errors.listFailed") : null}
          query={query}
          onQueryChange={setQuery}
          emptyTitle={t("specialties.empty")}
          emptyDescription={t("specialties.emptyDescription")}
          testId="specialties"
        />
      </AppShell>
    </Authenticated>
  );
}

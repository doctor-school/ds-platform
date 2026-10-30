"use client";

import { useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type {
  ProjectOutputKindAdminDetail,
  ProjectOutputKindAdminList,
  ProjectOutputKindStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";
import { projectOutputKindsUrl } from "@/providers/data-provider";

/**
 * «Виды результатов» (030 EARS-3; `output-kinds` of 030-design §Admin) — the
 * output-kind reference book on the `AdminDataList` block tier, the
 * organisation-role book one-to-one: title, status and the number of results
 * of the kind, with «Добавить вид»; the row opens the rename / retire / restore
 * record.
 *
 * The API answers the book WHOLE (no page, no `q`), so the list asks for no
 * search and no lifecycle facet the route would refuse, and the pager slices
 * the book it already holds. Retired kinds stay listed with their status: the
 * book is retained, never deleted.
 */
export default function ProjectOutputKindsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useCustom<ProjectOutputKindAdminList>({
    url: projectOutputKindsUrl.collection(),
    method: "get",
  });
  const book = result.data?.data ?? [];
  const start = (query.page - 1) * query.pageSize;
  const rows = book.slice(start, start + query.pageSize);

  const statusLabels: Record<ProjectOutputKindStatus, string> = {
    active: t("projectOutputKinds.statuses.active"),
    retired: t("projectOutputKinds.statuses.retired"),
  };

  const columns: DataTableColumn<ProjectOutputKindAdminDetail>[] = [
    {
      key: "resultCount",
      header: t("projectOutputKinds.columns.resultCount"),
      width: "26%",
      fullValue: (row) => String(row.resultCount),
      render: (row) => (
        <span data-testid={`output-kind-count-${row.slug}`}>
          {row.resultCount}
        </span>
      ),
    },
    {
      key: "status",
      header: t("projectOutputKinds.columns.status"),
      width: "20%",
      overflow: "wrap",
      render: (row) => (
        <span data-testid={`output-kind-status-${row.slug}`}>
          <StatusChip status={row.status} label={statusLabels[row.status]} />
        </span>
      ),
    },
  ];

  return (
    <Authenticated key="project-output-kinds-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<ProjectOutputKindAdminDetail, never>
          title={t("projectOutputKinds.listTitle")}
          description={t("projectOutputKinds.listDescription")}
          createHref="/project-output-kinds/create"
          createLabel={t("projectOutputKinds.createButton")}
          searchable={false}
          filterable={false}
          caption={t("projectOutputKinds.tableCaption")}
          record={{
            header: t("projectOutputKinds.columns.title"),
            width: "54%",
            title: (row) => (
              <span data-testid={`output-kind-row-${row.slug}`}>
                {row.title}
              </span>
            ),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          total={result.data?.total ?? 0}
          isLoading={request.isLoading}
          error={
            request.isError ? t("projectOutputKinds.errors.loadFailed") : null
          }
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/project-output-kinds/${row.id}`}
          emptyTitle={t("projectOutputKinds.empty")}
          emptyDescription={t("projectOutputKinds.emptyDescription")}
          testId="project-output-kinds"
        />
      </AppShell>
    </Authenticated>
  );
}

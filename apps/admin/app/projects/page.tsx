"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { ProjectAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";

/**
 * The project list (012-design §5.1, EARS-15) on the #1578 BLOCK TIER
 * (017-design §9.1–§9.3, EARS-16/17) — the same composition the direction and
 * specialty lists mount. Search and facets apply INSTANTLY, the applied set
 * renders as removable chips with one «Сбросить всё», and the pager reports the
 * honest page count.
 *
 * There is no «Действия» column: a project row has exactly one action, so the
 * whole ROW opens the record (EARS-16) and a column of identical
 * «Редактировать» buttons would restate the row.
 */
export default function ProjectsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<ProjectAdminListItem>({
    resource: "projects",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("projects.statuses.draft"),
    published: t("projects.statuses.published"),
    retired: t("projects.statuses.retired"),
  };

  const columns: DataTableColumn<ProjectAdminListItem>[] = [
    {
      key: "kind",
      header: t("projects.columns.kind"),
      width: "16%",
      overflow: "wrap",
      render: (row) => t(`projects.kinds.${row.kind}`),
    },
    {
      key: "slug",
      header: t("projects.columns.slug"),
      width: "22%",
      // A derived address is long and rarely read in full — it ellipses, and the
      // native `title` keeps the whole value reachable (the block's rule).
      fullValue: (row) => row.slug,
      render: (row) => (
        <span className="text-muted-foreground">{row.slug}</span>
      ),
    },
    {
      key: "status",
      header: t("projects.columns.status"),
      width: "18%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  return (
    <Authenticated key="projects-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<ProjectAdminListItem>
          title={t("projects.listTitle")}
          description={t("projects.listDescription")}
          createHref="/projects/create"
          createLabel={t("projects.createButton")}
          statusLabels={statusLabels}
          caption={t("projects.tableCaption")}
          record={{
            header: t("projects.columns.title"),
            width: "44%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.title}</span>
            ),
            // The second line is the fact the operator cannot read off the
            // title: when the row last moved.
            context: (row) =>
              t("projects.rowContext", {
                date: new Date(row.updatedAt).toLocaleDateString("ru-RU"),
              }),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as ProjectAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("projects.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/projects/${row.id}`}
          emptyTitle={t("projects.empty")}
          emptyDescription={t("projects.emptyDescription")}
          testId="projects"
        />
      </AppShell>
    </Authenticated>
  );
}

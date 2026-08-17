"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@ds/design-system";
import type { ProjectAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";

/**
 * The project list (012-design §5.1, EARS-15) on the SHARED admin list shell —
 * search, state filter, «показывать снятые с публикации» (off by default) and
 * page controls. #1284–#1286 mount the same shell for their kinds.
 */
export default function ProjectsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState>(
    ADMIN_LIST_INITIAL_QUERY,
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

  return (
    <Authenticated key="projects-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<ProjectAdminListItem>
          title={t("projects.listTitle")}
          description={t("projects.listDescription")}
          createHref="/projects/create"
          createLabel={t("projects.createButton")}
          statusLabels={statusLabels}
          columns={[
            { key: "title", label: t("projects.columns.title") },
            { key: "kind", label: t("projects.columns.kind") },
            { key: "slug", label: t("projects.columns.slug") },
            { key: "status", label: t("projects.columns.status") },
            { key: "actions", label: t("projects.columns.actions") },
          ]}
          rows={(result.data ?? []) as ProjectAdminListItem[]}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("projects.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("projects.empty")}
          testId="projects"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`project-row-${row.id}`}
            >
              <td className="px-4 py-3 font-semibold">{row.title}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {t(`projects.kinds.${row.kind}`)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{row.slug}</td>
              <td className="px-4 py-3">
                {/* The DS Badge has one neutral tag variant (`label`) plus the
                    on-air `live` one; a lifecycle state is not "live", so every
                    status renders as the neutral tag and the WORD carries the
                    meaning. */}
                <Badge variant="label" data-testid={`status-${row.status}`}>
                  {statusLabels[row.status]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/projects/${row.id}`}
                    data-testid={`edit-${row.id}`}
                  >
                    {t("projects.edit")}
                  </Link>
                </Button>
              </td>
            </tr>
          )}
        />
      </AppShell>
    </Authenticated>
  );
}

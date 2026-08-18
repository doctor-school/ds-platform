"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@ds/design-system";
import type { ExpertAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";

/**
 * The expert list (012-design §5.1, EARS-2/EARS-15) on the SHARED admin list
 * shell — the same search / state filter / «показывать снятые с публикации»
 * toggle / pagination the project list mounts, with no shell change: an expert
 * list is a taxonomy list, and giving it its own copy would be the drift #1297
 * later has to sweep.
 */
export default function ExpertsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState>(
    ADMIN_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<ExpertAdminListItem>({
    resource: "experts",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("experts.statuses.draft"),
    published: t("experts.statuses.published"),
    retired: t("experts.statuses.retired"),
  };

  return (
    <Authenticated key="experts-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<ExpertAdminListItem>
          title={t("experts.listTitle")}
          description={t("experts.listDescription")}
          createHref="/experts/create"
          createLabel={t("experts.createButton")}
          statusLabels={statusLabels}
          columns={[
            { key: "name", label: t("experts.columns.name") },
            {
              key: "professionalRole",
              label: t("experts.columns.professionalRole"),
            },
            { key: "slug", label: t("experts.columns.slug") },
            { key: "status", label: t("experts.columns.status") },
            { key: "actions", label: t("experts.columns.actions") },
          ]}
          rows={(result.data ?? []) as ExpertAdminListItem[]}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("experts.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("experts.empty")}
          testId="experts"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`expert-row-${row.id}`}
            >
              {/* A null name means the row was editorially removed (#1306, §2.4);
                  the id and the slug survive by design, so the row still renders
                  — labelled, never blank. */}
              <td className="px-4 py-3 font-semibold">
                {row.name ?? t("experts.removedName")}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.professionalRole ?? t("experts.notFilled")}
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
                    href={`/experts/${row.id}`}
                    data-testid={`edit-${row.id}`}
                  >
                    {t("experts.edit")}
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

"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@ds/design-system";
import type { DirectionAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";

/**
 * The curated-direction list (012-design §5.1, EARS-3) on the SHARED admin list
 * shell — the same search / state filter / «показывать снятые с публикации»
 * toggle / pagination the project and expert lists mount. A direction list is a
 * taxonomy list; giving it a private copy of the shell would be the drift #1297
 * later has to sweep.
 *
 * Three columns, because a direction has three facts: what it is called, where it
 * lives and what state it is in. There is no Delete action here and no delete
 * route behind one — a direction leaves circulation by being retired (EARS-14).
 */
export default function DirectionsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState>(
    ADMIN_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<DirectionAdminListItem>({
    resource: "directions",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("directions.statuses.draft"),
    published: t("directions.statuses.published"),
    retired: t("directions.statuses.retired"),
  };

  return (
    <Authenticated key="directions-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<DirectionAdminListItem>
          title={t("directions.listTitle")}
          description={t("directions.listDescription")}
          createHref="/directions/create"
          createLabel={t("directions.createButton")}
          statusLabels={statusLabels}
          columns={[
            { key: "title", label: t("directions.columns.title") },
            { key: "slug", label: t("directions.columns.slug") },
            { key: "status", label: t("directions.columns.status") },
            { key: "actions", label: t("directions.columns.actions") },
          ]}
          rows={(result.data ?? []) as DirectionAdminListItem[]}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("directions.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("directions.empty")}
          testId="directions"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`direction-row-${row.id}`}
            >
              <td className="px-4 py-3 font-semibold">{row.title}</td>
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
                    href={`/directions/${row.id}`}
                    data-testid={`edit-${row.id}`}
                  >
                    {t("directions.edit")}
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

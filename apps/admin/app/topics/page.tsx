"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@ds/design-system";
import type { TopicAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";

/**
 * The curated-topic list (012-design §5.1, EARS-3) on the SHARED admin list
 * shell — the same search / state filter / «показывать снятые с публикации»
 * toggle / pagination the project and expert lists mount. A topic list is a
 * taxonomy list; giving it a private copy of the shell would be the drift #1297
 * later has to sweep.
 *
 * Three columns, because a topic has three facts: what it is called, where it
 * lives and what state it is in. There is no Delete action here and no delete
 * route behind one — a topic leaves circulation by being retired (EARS-14).
 */
export default function TopicsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState>(
    ADMIN_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<TopicAdminListItem>({
    resource: "topics",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("topics.statuses.draft"),
    published: t("topics.statuses.published"),
    retired: t("topics.statuses.retired"),
  };

  return (
    <Authenticated key="topics-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<TopicAdminListItem>
          title={t("topics.listTitle")}
          description={t("topics.listDescription")}
          createHref="/topics/create"
          createLabel={t("topics.createButton")}
          statusLabels={statusLabels}
          columns={[
            { key: "title", label: t("topics.columns.title") },
            { key: "slug", label: t("topics.columns.slug") },
            { key: "status", label: t("topics.columns.status") },
            { key: "actions", label: t("topics.columns.actions") },
          ]}
          rows={(result.data ?? []) as TopicAdminListItem[]}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("topics.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("topics.empty")}
          testId="topics"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`topic-row-${row.id}`}
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
                    href={`/topics/${row.id}`}
                    data-testid={`edit-${row.id}`}
                  >
                    {t("topics.edit")}
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

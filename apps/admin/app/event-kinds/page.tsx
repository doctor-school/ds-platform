"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { EventKindAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";

/**
 * The event-kind dictionary list (012 EARS-25, #2509) — the Directions list
 * one-to-one («Как «Направления»»): two-line record rows above `md`, record
 * cards below, instant filters, a semantic status chip and one row action
 * (open the record). The second line carries what the title cannot: the
 * formats the kind allows. No delete anywhere — a kind is retired.
 */
export default function EventKindsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<EventKindAdminListItem>({
    resource: "event-kinds",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("eventKinds.statuses.draft"),
    published: t("eventKinds.statuses.published"),
    retired: t("eventKinds.statuses.retired"),
  };

  const columns: DataTableColumn<EventKindAdminListItem>[] = [
    {
      key: "status",
      header: t("eventKinds.columns.status"),
      width: "22%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  return (
    <Authenticated key="event-kinds-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<EventKindAdminListItem>
          title={t("eventKinds.listTitle")}
          description={t("eventKinds.listDescription")}
          createHref="/event-kinds/create"
          createLabel={t("eventKinds.createButton")}
          statusLabels={statusLabels}
          caption={t("eventKinds.tableCaption")}
          record={{
            header: t("eventKinds.columns.title"),
            width: "58%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.title}</span>
            ),
            context: (row) =>
              t("eventKinds.rowContext", {
                formats: row.allowedFormats
                  .map((format) => t(`events.participationFormats.${format}`))
                  .join(", "),
                date: new Date(row.updatedAt).toLocaleDateString("ru-RU"),
              }),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as EventKindAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("eventKinds.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/event-kinds/${row.id}`}
          emptyTitle={t("eventKinds.empty")}
          emptyDescription={t("eventKinds.emptyDescription")}
          testId="event-kinds"
        />
      </AppShell>
    </Authenticated>
  );
}

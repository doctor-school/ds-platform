"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { PartnerAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";

/**
 * The partner list (012-design §5.1, EARS-4/EARS-15) on the #1578 BLOCK TIER
 * (017-design §9.1–§9.3, EARS-16/17) — the same composition every other taxonomy
 * list mounts: instant search and facets, removable chips, one «Сбросить всё»,
 * an honest pager.
 *
 * The website column shows the address itself rather than a link out: this is an
 * inventory of cards, and the operator opens the card to check the link in the
 * context it will be published in. Following it from here would also fight the
 * row, which is itself the control that opens the record (EARS-16).
 */
export default function PartnersListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<PartnerAdminListItem>({
    resource: "partners",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("partners.statuses.draft"),
    published: t("partners.statuses.published"),
    retired: t("partners.statuses.retired"),
  };

  const columns: DataTableColumn<PartnerAdminListItem>[] = [
    {
      key: "websiteUrl",
      header: t("partners.columns.websiteUrl"),
      width: "24%",
      fullValue: (row) => row.websiteUrl ?? t("partners.notFilled"),
      render: (row) => (
        <span className="text-muted-foreground">
          {row.websiteUrl ?? t("partners.notFilled")}
        </span>
      ),
    },
    {
      key: "slug",
      header: t("partners.columns.slug"),
      width: "20%",
      fullValue: (row) => row.slug,
      render: (row) => (
        <span className="text-muted-foreground">{row.slug}</span>
      ),
    },
    {
      key: "status",
      header: t("partners.columns.status"),
      width: "18%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  return (
    <Authenticated key="partners-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<PartnerAdminListItem>
          title={t("partners.listTitle")}
          description={t("partners.listDescription")}
          createHref="/partners/create"
          createLabel={t("partners.createButton")}
          statusLabels={statusLabels}
          caption={t("partners.tableCaption")}
          record={{
            header: t("partners.columns.title"),
            width: "38%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.title}</span>
            ),
            context: (row) =>
              t("partners.rowContext", {
                date: new Date(row.updatedAt).toLocaleDateString("ru-RU"),
              }),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as PartnerAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("partners.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/partners/${row.id}`}
          emptyTitle={t("partners.empty")}
          emptyDescription={t("partners.emptyDescription")}
          testId="partners"
        />
      </AppShell>
    </Authenticated>
  );
}

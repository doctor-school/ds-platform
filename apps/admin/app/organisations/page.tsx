"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { OrganisationAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";

/**
 * «Организации» (032 EARS-1, EARS-14; `org-list` of 032-design §UI composition)
 * — the 012 partner list on the same #1578 block tier (`AdminDataList`,
 * `admin-list-block-tier-v1`): instant search by name and the status facet as
 * removable chips with one «Сбросить всё», an honest pager, the row as the
 * control that opens the full-page form.
 *
 * Columns are the spec's four: «Название», «Роли», «Статус», «Обновлено». The
 * role facet joins the toolbar with the `roleId` list filter of 032 EARS-9
 * (#3495) — a chip the API cannot yet honour would be a dead control.
 */
export default function OrganisationsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<OrganisationAdminListItem>({
    resource: "organisations",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("organisations.statuses.draft"),
    published: t("organisations.statuses.published"),
    retired: t("organisations.statuses.retired"),
  };

  const roleLine = (row: OrganisationAdminListItem) =>
    row.roles.length > 0
      ? row.roles.map((role) => role.title).join(", ")
      : t("organisations.noRoles");

  const columns: DataTableColumn<OrganisationAdminListItem>[] = [
    {
      key: "roles",
      header: t("organisations.columns.roles"),
      width: "30%",
      overflow: "wrap",
      fullValue: roleLine,
      render: (row) => (
        <span className="text-muted-foreground">{roleLine(row)}</span>
      ),
    },
    {
      key: "status",
      header: t("organisations.columns.status"),
      width: "18%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
    {
      key: "updatedAt",
      header: t("organisations.columns.updatedAt"),
      width: "16%",
      fullValue: (row) => new Date(row.updatedAt).toLocaleDateString("ru-RU"),
      render: (row) => (
        <span className="text-muted-foreground">
          {new Date(row.updatedAt).toLocaleDateString("ru-RU")}
        </span>
      ),
    },
  ];

  return (
    <Authenticated key="organisations-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<OrganisationAdminListItem>
          title={t("organisations.listTitle")}
          description={t("organisations.listDescription")}
          createHref="/organisations/create"
          createLabel={t("organisations.createButton")}
          statusLabels={statusLabels}
          caption={t("organisations.tableCaption")}
          record={{
            header: t("organisations.columns.title"),
            width: "36%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.title}</span>
            ),
            context: (row) => row.websiteUrl ?? t("organisations.noWebsite"),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as OrganisationAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("organisations.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/organisations/${row.id}`}
          emptyTitle={t("organisations.empty")}
          emptyDescription={t("organisations.emptyDescription")}
          testId="organisations"
        />
      </AppShell>
    </Authenticated>
  );
}

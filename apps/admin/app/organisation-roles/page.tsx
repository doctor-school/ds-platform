"use client";

import { useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type {
  OrganisationRoleAdminDetail,
  OrganisationRoleAdminList,
  OrganisationRoleStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";
import { organisationRolesUrl } from "@/providers/data-provider";

/**
 * «Роли организаций» (032 EARS-3, EARS-14; `org-roles` of 032-design §UI
 * composition) — the role reference book on the same `AdminDataList` block
 * tier: title, status and the number of organisations holding the role, with
 * «Добавить роль»; the row opens the rename form.
 *
 * The book is small and the API answers it WHOLE (`OrganisationRoleAdminListSchema`
 * has no page and no `q`), so the list asks for no search and no lifecycle
 * facet the route would refuse (`searchable={false}`, `filterable={false}`), and
 * the pager slices the book it already holds. Retiring a role (with the holders
 * a refused retire names) is the 032 lifecycle slice, #3493.
 */
export default function OrganisationRolesListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useCustom<OrganisationRoleAdminList>({
    url: organisationRolesUrl.collection(),
    method: "get",
  });
  const book = result.data?.data ?? [];
  const start = (query.page - 1) * query.pageSize;
  const rows = book.slice(start, start + query.pageSize);

  const statusLabels: Record<OrganisationRoleStatus, string> = {
    active: t("organisationRoles.statuses.active"),
    retired: t("organisationRoles.statuses.retired"),
  };

  const columns: DataTableColumn<OrganisationRoleAdminDetail>[] = [
    {
      key: "organisationCount",
      header: t("organisationRoles.columns.organisationCount"),
      width: "26%",
      fullValue: (row) => String(row.organisationCount),
      render: (row) => (
        <span data-testid={`role-count-${row.slug}`}>
          {row.organisationCount}
        </span>
      ),
    },
    {
      key: "status",
      header: t("organisationRoles.columns.status"),
      width: "20%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  return (
    <Authenticated key="organisation-roles-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<OrganisationRoleAdminDetail, never>
          title={t("organisationRoles.listTitle")}
          description={t("organisationRoles.listDescription")}
          createHref="/organisation-roles/create"
          createLabel={t("organisationRoles.createButton")}
          searchable={false}
          filterable={false}
          caption={t("organisationRoles.tableCaption")}
          record={{
            header: t("organisationRoles.columns.title"),
            width: "54%",
            title: (row) => (
              <span data-testid={`role-row-${row.slug}`}>{row.title}</span>
            ),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          total={result.data?.total ?? 0}
          isLoading={request.isLoading}
          error={
            request.isError ? t("organisationRoles.errors.loadFailed") : null
          }
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/organisation-roles/${row.id}`}
          emptyTitle={t("organisationRoles.empty")}
          emptyDescription={t("organisationRoles.emptyDescription")}
          testId="organisation-roles"
        />
      </AppShell>
    </Authenticated>
  );
}

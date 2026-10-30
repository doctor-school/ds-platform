"use client";

import { useState } from "react";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import {
  MaterialKindSchema,
  MaterialStatusSchema,
  type MaterialAdminListItem,
  type MaterialKind,
  type MaterialStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";
import { formatMaterialDate } from "@/lib/material-dates";

/**
 * «Материалы» (048 EARS-7; `material-list` of 048-design §Admin) on the shared
 * `AdminDataList` block tier — the same shell as «Организации»: instant search
 * by title, the status facet («Черновик» / «Опубликован») and the kind facet as
 * removable chips with one «Сбросить всё», an honest pager, «Новый материал»,
 * the empty state, the row as the control that opens the full-page form.
 *
 * A material is a draft or published and nothing else, so the list carries no
 * «показывать снятые» switch (`retainsRetired={false}`). A published column
 * whose expert is no longer published carries the mark «Не на сайте: эксперт
 * не опубликован» under its status — the read-time rule of EARS-9 / EARS-11.
 */
export default function MaterialsListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<MaterialStatus>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [kind, setKind] = useState<MaterialKind | "">("");
  const { result, query: request } = useList<MaterialAdminListItem>({
    resource: "materials",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "kind", operator: "eq", value: kind },
    ],
  });

  const statusLabels: Record<MaterialStatus, string> = {
    draft: t("materials.statuses.draft"),
    published: t("materials.statuses.published"),
  };
  const kindLabel = (value: MaterialKind) => t(`materials.kinds.${value}`);

  const columns: DataTableColumn<MaterialAdminListItem>[] = [
    {
      key: "kind",
      header: t("materials.columns.kind"),
      width: "16%",
      overflow: "wrap",
      render: (row) => (
        <span className="text-muted-foreground">{kindLabel(row.kind)}</span>
      ),
    },
    {
      key: "status",
      header: t("materials.columns.status"),
      width: "20%",
      overflow: "wrap",
      render: (row) => (
        <div className="flex flex-col items-start gap-1.5">
          <StatusChip status={row.status} label={statusLabels[row.status]} />
          {row.expertNotPublished ? (
            <Badge
              variant="label"
              data-testid={`material-expert-not-published-${row.id}`}
            >
              {t("materials.expertNotPublished")}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "firstPublishedAt",
      header: t("materials.columns.firstPublishedAt"),
      width: "16%",
      fullValue: (row) =>
        row.firstPublishedAt
          ? formatMaterialDate(row.firstPublishedAt)
          : t("materials.neverPublished"),
      render: (row) => (
        <span className="text-muted-foreground">
          {row.firstPublishedAt
            ? formatMaterialDate(row.firstPublishedAt)
            : t("materials.neverPublished")}
        </span>
      ),
    },
    {
      key: "author",
      header: t("materials.columns.author"),
      width: "16%",
      overflow: "wrap",
      fullValue: (row) => row.author ?? t("common.notSet"),
      render: (row) => (
        <span className="text-muted-foreground">
          {row.author ?? t("common.notSet")}
        </span>
      ),
    },
  ];

  return (
    <Authenticated key="materials-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<MaterialAdminListItem, MaterialStatus>
          title={t("materials.listTitle")}
          description={t("materials.listDescription")}
          createHref="/materials/create"
          createLabel={t("materials.createButton")}
          statusLabels={statusLabels}
          statuses={MaterialStatusSchema.options}
          retainsRetired={false}
          searchPlaceholder={t("materials.searchPlaceholder")}
          caption={t("materials.tableCaption")}
          extraFilters={
            <div className="flex flex-col gap-1.5 sm:w-56">
              <Label htmlFor="materials-kind">
                {t("materials.filters.kind")}
              </Label>
              <NativeSelect
                id="materials-kind"
                value={kind}
                data-testid="materials-kind-filter"
                onChange={(event) => {
                  setKind(event.target.value as MaterialKind | "");
                  setQuery({ ...query, page: 1 });
                }}
              >
                <option value="">{t("materials.filters.kindAny")}</option>
                {MaterialKindSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {kindLabel(value)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          }
          extraApplied={
            kind
              ? [
                  {
                    id: "kind",
                    label: kindLabel(kind),
                    onRemove: () => {
                      setKind("");
                      setQuery({ ...query, page: 1 });
                    },
                  },
                ]
              : []
          }
          record={{
            header: t("materials.columns.title"),
            width: "32%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.title}</span>
            ),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={(result.data ?? []) as MaterialAdminListItem[]}
          getRowKey={(row) => row.id}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("materials.errors.listFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/materials/${row.id}`}
          emptyTitle={t("materials.empty")}
          emptyDescription={t("materials.emptyDescription")}
          testId="materials"
        />
      </AppShell>
    </Authenticated>
  );
}

"use client";

import { useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import {
  RELATIONSHIP_STATUSES,
  type DirectionAdjacencyAdminDetail,
  type DirectionAdjacencyAdminList,
  type RelationshipStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";
import { directionAdjacencyUrl } from "@/providers/data-provider";
import {
  useDirectionAdjacencyKindLabel,
  useDirectionOptions,
} from "@/lib/direction-relation-options";

/**
 * The direction adjacency list (#1483; ADR-0016 §5, 017-design §9) on the #1578
 * block tier, with the relationship status vocabulary and no search box for the
 * same two reasons the specialty-link list has them: an edge is `active` or
 * `retired`, and its list query is `.strict()` with no `q`.
 *
 * «Вес» has no column: weight is a tuning parameter of the targeting resolution,
 * absent from the operator interface in every form (017-design §9.3). «Вид связи»
 * renders its RU label, never the stored slug.
 *
 * The direction filter reads «что рядом с этим направлением» — it scopes by the
 * edge's SOURCE. The reverse question («кто считает это направление смежным») is
 * askable of the same route via `adjacentDirectionId`, and is left to #1484's
 * targeting screens rather than given a second control here that most operators
 * would read as the same filter.
 */
export default function DirectionAdjacencyListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<RelationshipStatus>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [directionId, setDirectionId] = useState("");
  const { directions } = useDirectionOptions();
  const kindLabel = useDirectionAdjacencyKindLabel();

  const { result, query: request } = useCustom<DirectionAdjacencyAdminList>({
    url: directionAdjacencyUrl.list({
      page: query.page,
      pageSize: query.pageSize,
      ...(directionId ? { directionId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.includeRetired ? { includeRetired: true } : {}),
    }),
    method: "get",
  });

  const statusLabels: Record<RelationshipStatus, string> = {
    active: t("directionAdjacency.statuses.active"),
    retired: t("directionAdjacency.statuses.retired"),
  };

  const columns: DataTableColumn<DirectionAdjacencyAdminDetail>[] = [
    {
      key: "kind",
      header: t("directionAdjacency.columns.kind"),
      width: "24%",
      overflow: "wrap",
      render: (row) => kindLabel(row.kind),
      fullValue: (row) => kindLabel(row.kind),
    },
    {
      key: "status",
      header: t("directionAdjacency.columns.status"),
      width: "18%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip status={row.status} label={statusLabels[row.status]} />
      ),
    },
  ];

  const selectedDirection = directions.find(
    (option) => option.id === directionId,
  );

  return (
    <Authenticated key="direction-adjacency-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<DirectionAdjacencyAdminDetail, RelationshipStatus>
          title={t("directionAdjacency.listTitle")}
          description={t("directionAdjacency.listDescription")}
          createHref="/direction-adjacency/create"
          createLabel={t("directionAdjacency.createButton")}
          statusLabels={statusLabels}
          statuses={RELATIONSHIP_STATUSES}
          searchable={false}
          caption={t("directionAdjacency.tableCaption")}
          extraFilters={
            <div className="flex flex-col gap-1.5 sm:w-64">
              <Label htmlFor="direction-adjacency-direction">
                {t("directionAdjacency.filters.direction")}
              </Label>
              <NativeSelect
                id="direction-adjacency-direction"
                value={directionId}
                data-testid="direction-adjacency-direction-filter"
                onChange={(event) => {
                  setDirectionId(event.target.value);
                  setQuery({ ...query, page: 1 });
                }}
              >
                <option value="">
                  {t("directionAdjacency.filters.directionAny")}
                </option>
                {directions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          }
          extraApplied={
            selectedDirection
              ? [
                  {
                    id: "directionId",
                    label: selectedDirection.label,
                    onRemove: () => {
                      setDirectionId("");
                      setQuery({ ...query, page: 1 });
                    },
                  },
                ]
              : []
          }
          record={{
            header: t("directionAdjacency.columns.direction"),
            width: "40%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.directionTitle}</span>
            ),
            context: (row) =>
              t("directionAdjacency.rowContext", {
                adjacent: row.adjacentDirectionTitle,
              }),
            label: (row) =>
              `${row.directionTitle} — ${row.adjacentDirectionTitle}`,
          }}
          columns={columns}
          rows={result.data?.data ?? []}
          getRowKey={(row) => row.id}
          total={result.data?.total ?? 0}
          isLoading={request.isLoading}
          error={
            request.isError ? t("directionAdjacency.errors.listFailed") : null
          }
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/direction-adjacency/${row.id}`}
          emptyTitle={t("directionAdjacency.empty")}
          emptyDescription={t("directionAdjacency.emptyDescription")}
          testId="direction-adjacency"
        />
      </AppShell>
    </Authenticated>
  );
}

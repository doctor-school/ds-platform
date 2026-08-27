"use client";

import { useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import {
  RELATIONSHIP_STATUSES,
  type DirectionSpecialtyAdminList,
  type DirectionSpecialtyAdminDetail,
  type RelationshipStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { StatusChip } from "@/components/status-chip";
import { directionSpecialtiesUrl } from "@/providers/data-provider";
import { useDirectionOptions } from "@/lib/direction-relation-options";

/**
 * The direction↔specialty link list (#1483; ADR-0016 §5, 017-design §9) on the
 * #1578 block tier — the same `DataTable` / `FilterBar` composition the direction
 * book mounts, so a relation list reads as the same application rather than as a
 * per-section arrangement.
 *
 * Two things it asks the composition for that the direction book does not:
 *
 *   - `statuses={RELATIONSHIP_STATUSES}` — a link is `active` or `retired`, never
 *     `draft`. Left to the default, the filter would offer a state a link row can
 *     never be in.
 *   - `searchable={false}` — `DirectionSpecialtyAdminListQuerySchema` is `.strict()`
 *     and accepts no `q`; it scopes by ENDPOINT instead. Rendering a search box the
 *     API would refuse is the same broken promise a dead field would be, so the
 *     direction picker takes its place as a facet — and, being a facet, gets its
 *     own removable chip.
 */
export default function DirectionSpecialtiesListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<RelationshipStatus>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [directionId, setDirectionId] = useState("");
  const { directions } = useDirectionOptions();

  const { result, query: request } = useCustom<DirectionSpecialtyAdminList>({
    url: directionSpecialtiesUrl.list({
      page: query.page,
      pageSize: query.pageSize,
      ...(directionId ? { directionId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.includeRetired ? { includeRetired: true } : {}),
    }),
    method: "get",
  });

  const statusLabels: Record<RelationshipStatus, string> = {
    active: t("directionSpecialties.statuses.active"),
    retired: t("directionSpecialties.statuses.retired"),
  };

  const columns: DataTableColumn<DirectionSpecialtyAdminDetail>[] = [
    {
      key: "specialtyCode",
      header: t("directionSpecialties.columns.specialtyCode"),
      width: "20%",
      render: (row) => row.specialtyCode,
      fullValue: (row) => row.specialtyCode,
      hideOnCard: true,
    },
    {
      key: "status",
      header: t("directionSpecialties.columns.status"),
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
    <Authenticated key="direction-specialties-list" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<DirectionSpecialtyAdminDetail, RelationshipStatus>
          title={t("directionSpecialties.listTitle")}
          description={t("directionSpecialties.listDescription")}
          createHref="/direction-specialties/create"
          createLabel={t("directionSpecialties.createButton")}
          statusLabels={statusLabels}
          statuses={RELATIONSHIP_STATUSES}
          searchable={false}
          caption={t("directionSpecialties.tableCaption")}
          extraFilters={
            <div className="flex flex-col gap-1.5 sm:w-64">
              <Label htmlFor="direction-specialties-direction">
                {t("directionSpecialties.filters.direction")}
              </Label>
              <NativeSelect
                id="direction-specialties-direction"
                value={directionId}
                data-testid="direction-specialties-direction-filter"
                onChange={(event) => {
                  setDirectionId(event.target.value);
                  setQuery({ ...query, page: 1 });
                }}
              >
                <option value="">
                  {t("directionSpecialties.filters.directionAny")}
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
            header: t("directionSpecialties.columns.direction"),
            width: "44%",
            title: (row) => (
              <span data-testid={`row-${row.id}`}>{row.directionTitle}</span>
            ),
            context: (row) =>
              t("directionSpecialties.rowContext", {
                specialty: row.specialtyName,
                code: row.specialtyCode,
              }),
            label: (row) => `${row.directionTitle} — ${row.specialtyName}`,
          }}
          columns={columns}
          rows={result.data?.data ?? []}
          getRowKey={(row) => row.id}
          total={result.data?.total ?? 0}
          isLoading={request.isLoading}
          error={
            request.isError ? t("directionSpecialties.errors.listFailed") : null
          }
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/direction-specialties/${row.id}`}
          emptyTitle={t("directionSpecialties.empty")}
          emptyDescription={t("directionSpecialties.emptyDescription")}
          testId="direction-specialties"
        />
      </AppShell>
    </Authenticated>
  );
}

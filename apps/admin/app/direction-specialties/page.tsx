"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button, Label, NativeSelect } from "@ds/design-system";
import {
  RELATIONSHIP_STATUSES,
  type DirectionSpecialtyAdminList,
  type DirectionSpecialtyAdminDetail,
  type RelationshipStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";
import { directionSpecialtiesUrl } from "@/providers/data-provider";
import { useDirectionOptions } from "@/lib/direction-relation-options";

/**
 * The direction↔specialty link list (#1483; ADR-0016 §5, 017-design §5) on the
 * SAME shared admin list shell the four 012 entity lists mount — a relation list
 * is still an admin list, and a private copy of the shell is exactly the drift the
 * shell's own header rules out.
 *
 * Two things it asks the shell for that a 012 list does not:
 *
 *   - `statuses={RELATIONSHIP_STATUSES}` — a link is `active` or `retired`, never
 *     `draft`. Left to the default, the filter would offer a state a link row can
 *     never be in.
 *   - `searchable={false}` — `DirectionSpecialtyAdminListQuerySchema` is `.strict()`
 *     and accepts no `q`; it scopes by ENDPOINT instead. Rendering a search box the
 *     API would refuse is the same broken promise a dead field would be, so the
 *     shell renders the direction picker in its place via `extraFilters`.
 */
export default function DirectionSpecialtiesListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState<RelationshipStatus>>(
    ADMIN_LIST_INITIAL_QUERY,
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

  return (
    <Authenticated key="direction-specialties-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<DirectionSpecialtyAdminDetail, RelationshipStatus>
          title={t("directionSpecialties.listTitle")}
          description={t("directionSpecialties.listDescription")}
          createHref="/direction-specialties/create"
          createLabel={t("directionSpecialties.createButton")}
          statusLabels={statusLabels}
          statuses={RELATIONSHIP_STATUSES}
          searchable={false}
          extraFilters={
            <div className="flex flex-1 flex-col gap-1.5">
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
          columns={[
            { key: "direction", label: t("directionSpecialties.columns.direction") },
            { key: "specialty", label: t("directionSpecialties.columns.specialty") },
            {
              key: "specialtyCode",
              label: t("directionSpecialties.columns.specialtyCode"),
            },
            { key: "status", label: t("directionSpecialties.columns.status") },
            { key: "actions", label: t("directionSpecialties.columns.actions") },
          ]}
          rows={result.data?.data ?? []}
          total={result.data?.total ?? 0}
          isLoading={request.isLoading}
          error={
            request.isError ? t("directionSpecialties.errors.listFailed") : null
          }
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("directionSpecialties.empty")}
          testId="direction-specialties"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`direction-specialty-row-${row.id}`}
            >
              <td className="px-4 py-3 font-semibold">{row.directionTitle}</td>
              <td className="px-4 py-3">{row.specialtyName}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.specialtyCode}
              </td>
              <td className="px-4 py-3">
                <Badge variant="label" data-testid={`status-${row.status}`}>
                  {statusLabels[row.status]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/direction-specialties/${row.id}`}
                    data-testid={`open-${row.id}`}
                  >
                    {t("directionSpecialties.open")}
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

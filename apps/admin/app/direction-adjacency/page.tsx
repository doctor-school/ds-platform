"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button, Label, NativeSelect } from "@ds/design-system";
import {
  RELATIONSHIP_STATUSES,
  type DirectionAdjacencyAdminDetail,
  type DirectionAdjacencyAdminList,
  type RelationshipStatus,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";
import { directionAdjacencyUrl } from "@/providers/data-provider";
import { useDirectionOptions } from "@/lib/direction-relation-options";

/**
 * The direction adjacency list (#1483; ADR-0016 §5, 017-design §5) on the shared
 * admin list shell, with the relationship status vocabulary and no search box for
 * the same two reasons the specialty-link list has them: an edge is `active` or
 * `retired`, and its list query is `.strict()` with no `q`.
 *
 * The direction filter reads «что рядом с этим направлением» — it scopes by the
 * edge's SOURCE. The reverse question («кто считает это направление смежным») is
 * askable of the same route via `adjacentDirectionId`, and is left to #1484's
 * targeting screens rather than given a second control here that most operators
 * would read as the same filter.
 */
export default function DirectionAdjacencyListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState<RelationshipStatus>>(
    ADMIN_LIST_INITIAL_QUERY,
  );
  const [directionId, setDirectionId] = useState("");
  const { directions } = useDirectionOptions();

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

  return (
    <Authenticated key="direction-adjacency-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<DirectionAdjacencyAdminDetail, RelationshipStatus>
          title={t("directionAdjacency.listTitle")}
          description={t("directionAdjacency.listDescription")}
          createHref="/direction-adjacency/create"
          createLabel={t("directionAdjacency.createButton")}
          statusLabels={statusLabels}
          statuses={RELATIONSHIP_STATUSES}
          searchable={false}
          extraFilters={
            <div className="flex flex-1 flex-col gap-1.5">
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
          columns={[
            { key: "direction", label: t("directionAdjacency.columns.direction") },
            {
              key: "adjacentDirection",
              label: t("directionAdjacency.columns.adjacentDirection"),
            },
            { key: "kind", label: t("directionAdjacency.columns.kind") },
            { key: "weight", label: t("directionAdjacency.columns.weight") },
            { key: "status", label: t("directionAdjacency.columns.status") },
            { key: "actions", label: t("directionAdjacency.columns.actions") },
          ]}
          rows={result.data?.data ?? []}
          total={result.data?.total ?? 0}
          isLoading={request.isLoading}
          error={
            request.isError ? t("directionAdjacency.errors.listFailed") : null
          }
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("directionAdjacency.empty")}
          testId="direction-adjacency"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`direction-adjacency-row-${row.id}`}
            >
              <td className="px-4 py-3 font-semibold">{row.directionTitle}</td>
              <td className="px-4 py-3">{row.adjacentDirectionTitle}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.kind}</td>
              <td className="px-4 py-3">{row.weight}</td>
              <td className="px-4 py-3">
                <Badge variant="label" data-testid={`status-${row.status}`}>
                  {statusLabels[row.status]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/direction-adjacency/${row.id}`}
                    data-testid={`open-${row.id}`}
                  >
                    {t("directionAdjacency.open")}
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

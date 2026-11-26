"use client";

import { useMemo, useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { LearningSchoolAdmin, LearningSchoolList } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { useDirectionOptions } from "@/lib/direction-relation-options";
import { learningUrl } from "@/providers/data-provider";

type SchoolRow = LearningSchoolAdmin & { directionTitle: string };

/**
 * «Школы» (023 EARS-26, #4018) — the platform's schools by direction on the
 * `AdminDataList` block tier: grouped in direction order, a row opening the
 * school editor (its data, publish / unpublish, its courses), «Создать школу»
 * leading to the create form. The API answers the list whole, so the search
 * (title or slug) and the pager work on what it holds, like «Обучение».
 */
export default function LearningSchoolsPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useCustom<LearningSchoolList>({
    url: learningUrl.schools(),
    method: "get",
  });
  const { directions } = useDirectionOptions();
  const schools = useMemo<SchoolRow[]>(() => {
    const titles = new Map(directions.map((d) => [d.id, d.label]));
    return (result.data?.data ?? [])
      .map((s) => ({
        ...s,
        directionTitle: titles.get(s.directionId) ?? "—",
      }))
      .sort(
        (a, b) =>
          a.directionTitle.localeCompare(b.directionTitle, "ru") ||
          a.title.localeCompare(b.title, "ru"),
      );
  }, [result.data, directions]);
  const needle = query.q.trim().toLowerCase();
  const found = schools.filter(
    (row) =>
      !needle ||
      row.title.toLowerCase().includes(needle) ||
      row.slug.toLowerCase().includes(needle),
  );
  const start = (query.page - 1) * query.pageSize;
  const rows = found.slice(start, start + query.pageSize);

  const columns: DataTableColumn<SchoolRow>[] = [
    {
      key: "direction",
      header: t("learning.schools.columns.direction"),
      width: "30%",
      overflow: "wrap",
      render: (row) => row.directionTitle,
    },
    {
      key: "state",
      header: t("learning.schools.columns.state"),
      width: "20%",
      overflow: "wrap",
      render: (row) => (
        <Badge
          variant={row.state === "published" ? "success" : "label"}
          data-testid={`learning-school-state-${row.slug}`}
        >
          {t(`learning.schools.states.${row.state}`)}
        </Badge>
      ),
    },
  ];

  return (
    <Authenticated key="learning-schools" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/learning"
            label={t("learning.schools.backToCourses")}
          />
        </div>
        <AdminDataList<SchoolRow, never>
          title={t("learning.schools.listTitle")}
          description={t("learning.schools.listDescription")}
          createHref="/learning/schools/new"
          createLabel={t("learning.schools.create")}
          searchLabel={t("learning.schools.searchLabel")}
          searchPlaceholder={t("learning.schools.searchPlaceholder")}
          filterable={false}
          caption={t("learning.schools.tableCaption")}
          record={{
            header: t("learning.schools.columns.school"),
            width: "50%",
            title: (row) => (
              <span data-testid={`learning-school-row-${row.slug}`}>
                {row.title}
              </span>
            ),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          total={found.length}
          isLoading={request.isLoading}
          error={request.isError ? t("learning.schools.listFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/learning/schools/${row.id}`}
          emptyTitle={t("learning.schools.empty")}
          emptyDescription={t("learning.schools.emptyDescription")}
          testId="learning-schools"
        />
      </AppShell>
    </Authenticated>
  );
}

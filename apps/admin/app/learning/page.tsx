"use client";

import { useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { LearningCourseAdmin, LearningCourseList } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { learningUrl } from "@/providers/data-provider";

/**
 * «Обучение» (024 EARS-28 / EARS-29, #4011) — the platform's courses on the
 * `AdminDataList` block tier; a row opens the course's composition (modules,
 * lessons, the course's rule preset). The API answers the list whole, so the
 * search (title or slug) and the pager work on what it holds, like «Доступы». Courses
 * themselves are created through the admin API in slice 1 (024-design §10);
 * the school → course structure editor is #4018.
 */
export default function LearningCoursesPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useCustom<LearningCourseList>({
    url: learningUrl.courses(),
    method: "get",
  });
  const needle = query.q.trim().toLowerCase();
  const courses = (result.data?.data ?? []).filter(
    (row) =>
      !needle ||
      row.title.toLowerCase().includes(needle) ||
      row.slug.toLowerCase().includes(needle),
  );
  const start = (query.page - 1) * query.pageSize;
  const rows = courses.slice(start, start + query.pageSize);

  const columns: DataTableColumn<LearningCourseAdmin>[] = [
    {
      key: "state",
      header: t("learning.columns.state"),
      width: "30%",
      overflow: "wrap",
      render: (row) => (
        <Badge
          variant={row.state === "published" ? "success" : "label"}
          data-testid={`learning-course-state-${row.slug}`}
        >
          {t(`learning.states.${row.state}`)}
        </Badge>
      ),
    },
  ];

  return (
    <Authenticated key="learning-courses" redirectOnFail="/login">
      <AppShell>
        <AdminDataList<LearningCourseAdmin, never>
          title={t("learning.listTitle")}
          description={t("learning.listDescription")}
          searchLabel={t("learning.searchLabel")}
          searchPlaceholder={t("learning.searchPlaceholder")}
          filterable={false}
          caption={t("learning.tableCaption")}
          record={{
            header: t("learning.columns.course"),
            width: "70%",
            title: (row) => (
              <span data-testid={`learning-course-row-${row.slug}`}>
                {row.title}
              </span>
            ),
            label: (row) => row.title,
          }}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          total={courses.length}
          isLoading={request.isLoading}
          error={request.isError ? t("learning.errors.listFailed") : null}
          query={query}
          onQueryChange={setQuery}
          rowHref={(row) => `/learning/courses/${row.id}`}
          emptyTitle={t("learning.empty")}
          emptyDescription={t("learning.emptyDescription")}
          testId="learning-courses"
        />
      </AppShell>
    </Authenticated>
  );
}

"use client";

import { useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import {
  FEED_VK_MONTHLY_CALL_CAP,
  type FeedSourceAdmin,
  type FeedSourceAdminList,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { FeedSourceRowActions } from "@/components/feed-source-row-actions";
import { MaterialsSubnav } from "@/components/materials-subnav";
import { StatusChip } from "@/components/status-chip";
import {
  feedSourceAddressLabel,
  vkCallsNearCap,
} from "@/lib/feed-source-address";
import { formatMskDateTime } from "@/lib/msk";
import { feedSourcesUrl } from "@/providers/data-provider";

/**
 * «Источники» (048 EARS-20…EARS-23; `sources-list` of 048-design §Admin) —
 * the official accounts the feed takes posts from, on the `AdminDataList`
 * block tier, reached from the «Материалы» sub-navigation: platform, the
 * address as `t.me/<имя>`, «Включён» / «Выключен», the EARS-31 status with
 * the time of the last check, the number of its posts in the feed, and per
 * row «Изменить адрес» + «Выключить» / «Включить»; «Добавить источник» opens
 * the add form; «Источников пока нет.» when there is none. A VK source
 * (EARS-38, EARS-44) is listed as `vk.com/<имя>` with its VK reasons, and
 * while one is listed the line «Вызовов VK в этом месяце: N из 10 000» stands
 * above the list — a warning from 8 000 on, the threshold at which the check
 * itself reads «Лимит вызовов VK почти исчерпан».
 *
 * The API answers the list WHOLE (no page, no `q`), so the page asks for no
 * search or facet the route would refuse, and the pager slices what it holds.
 * The check that sets «Работает» / «Ошибка» belongs to the Telegram connector
 * (#3994): until it runs, a source reads «Не проверен». «Публикации» — the
 * row's posts (EARS-32) — is a row action, so the row itself stays inert.
 */
export default function FeedSourcesListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [banner, setBanner] = useState<{
    variant: "success" | "danger";
    text: string;
  } | null>(null);
  const { result, query: request } = useCustom<FeedSourceAdminList>({
    url: feedSourcesUrl.collection(),
    method: "get",
  });
  const all = result.data?.data ?? [];
  const start = (query.page - 1) * query.pageSize;
  const rows = all.slice(start, start + query.pageSize);
  const vkCalls = result.data?.vkCallsThisMonth ?? 0;
  const hasVk = all.some((row) => row.platform === "vk");
  const nearCap = vkCallsNearCap(vkCalls);
  const formatCount = (n: number) => n.toLocaleString("ru-RU");

  const columns: DataTableColumn<FeedSourceAdmin>[] = [
    {
      key: "platform",
      header: t("feedSources.columns.platform"),
      width: "14%",
      render: (row) => (
        <span className="text-muted-foreground">
          {t(`feedSources.platforms.${row.platform}`)}
        </span>
      ),
    },
    {
      key: "enabled",
      header: t("feedSources.columns.state"),
      width: "14%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip
          status={row.enabled ? "enabled" : "disabled"}
          label={t(
            row.enabled
              ? "feedSources.states.enabled"
              : "feedSources.states.disabled",
          )}
          testId={`feed-source-state-${row.address}`}
        />
      ),
    },
    {
      key: "status",
      header: t("feedSources.columns.status"),
      width: "26%",
      overflow: "wrap",
      render: (row) => (
        <div className="flex flex-col items-start gap-1.5">
          <StatusChip
            status={row.status}
            label={
              row.status === "failing" && row.statusReason
                ? t("feedSources.statuses.failingWithReason", {
                    reason: row.statusReason,
                  })
                : t(`feedSources.statuses.${row.status}`)
            }
            testId={`feed-source-status-${row.address}`}
          />
          <span
            className="text-xs text-muted-foreground"
            data-testid={`feed-source-checked-${row.address}`}
          >
            {row.checkedAt
              ? t("feedSources.checkedAt", {
                  time: formatMskDateTime(row.checkedAt),
                })
              : t("feedSources.neverChecked")}
          </span>
        </div>
      ),
    },
    {
      key: "entryCount",
      header: t("feedSources.columns.entryCount"),
      width: "12%",
      fullValue: (row) => String(row.entryCount),
      render: (row) => (
        <span data-testid={`feed-source-count-${row.address}`}>
          {row.entryCount}
        </span>
      ),
    },
  ];

  return (
    <Authenticated key="feed-sources-list" redirectOnFail="/login">
      <AppShell>
        <MaterialsSubnav />
        {banner ? (
          <Alert
            variant={banner.variant}
            className="mb-4"
            data-testid={
              banner.variant === "success"
                ? "feed-source-notice"
                : "feed-source-error"
            }
          >
            {banner.text}
          </Alert>
        ) : null}
        {hasVk ? (
          <Alert
            variant={nearCap ? "warn" : "info"}
            className="mb-4"
            data-testid="feed-sources-vk-calls"
            data-state={nearCap ? "warn" : "normal"}
          >
            {t(nearCap ? "feedSources.vkCallsWarn" : "feedSources.vkCalls", {
              calls: formatCount(vkCalls),
              cap: formatCount(FEED_VK_MONTHLY_CALL_CAP),
            })}
          </Alert>
        ) : null}
        <AdminDataList<FeedSourceAdmin, never>
          title={t("feedSources.listTitle")}
          description={t("feedSources.listDescription")}
          createHref="/materials/sources/create"
          createLabel={t("feedSources.createButton")}
          searchable={false}
          filterable={false}
          caption={t("feedSources.tableCaption")}
          record={{
            header: t("feedSources.columns.address"),
            width: "20%",
            title: (row) => (
              <span data-testid={`feed-source-row-${row.address}`}>
                {feedSourceAddressLabel(row.platform, row.address)}
              </span>
            ),
            label: (row) => feedSourceAddressLabel(row.platform, row.address),
          }}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          total={all.length}
          isLoading={request.isLoading}
          error={request.isError ? t("feedSources.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          actionsHeader={t("feedSources.columns.actions")}
          actions={(row) => (
            <FeedSourceRowActions
              source={row}
              onStarted={() => setBanner(null)}
              onChanged={(text) => {
                setBanner({ variant: "success", text });
                void request.refetch();
              }}
              onFailed={(text) => {
                setBanner({ variant: "danger", text });
                void request.refetch();
              }}
            />
          )}
          emptyTitle={t("feedSources.empty")}
          emptyDescription={t("feedSources.emptyDescription")}
          testId="feed-sources"
        />
      </AppShell>
    </Authenticated>
  );
}

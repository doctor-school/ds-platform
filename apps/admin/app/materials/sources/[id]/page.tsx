"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Authenticated, useCustom, useDataProvider } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Alert, Link as DsLink } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import type { FeedEntryAdmin, FeedEntryAdminList } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import { BackToList } from "@/components/back-to-list";
import { FeedPostRowActions } from "@/components/feed-post-row-actions";
import { StatusChip } from "@/components/status-chip";
import { feedSourceAddressLabel } from "@/lib/feed-source-address";
import { formatMskDateTime } from "@/lib/msk";
import { feedSourcesUrl } from "@/providers/data-provider";

/**
 * «Публикации» (048 EARS-32; `source-posts` of 048-design §Admin) — one
 * source's posts, newest first, on the `AdminDataList` block tier, reached
 * from the «Публикации» row action of «Источники»: the post text cut to its
 * first line with «Открыть в Telegram ↗» (a new tab), the date, «В ленте» /
 * «Скрыт» / «Источник выключен», and per row «Скрыть из ленты» (behind a
 * confirmation) or «Вернуть в ленту». The standing note says the one thing an
 * operator cannot guess: a post deleted in Telegram stays in the feed until
 * it is hidden here (the Bot API sends no deletion update).
 *
 * A VK source (EARS-47) lists its posts and videos alike — the «Вид» column
 * says which —, «Открыть в VK ↗», the state «Удалён в VK» of an entry the
 * wall reconcile found gone, and the note that a video removed in VK stays
 * (videos are not reconciled). Hide and return apply unchanged.
 *
 * The API pages by cursor (newest first) and names the total in the source's
 * `entryCount`, so the pager shows real page numbers: the cursor of each page
 * the operator reached is kept, and a jump past them reads the pages in
 * between to learn their cursors.
 */
export default function FeedSourcePostsPage() {
  const t = useTranslations();
  const { id } = useParams<{ id: string }>();
  const dataProvider = useDataProvider();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  /** `cursors[p - 1]` reads page `p`; page 1 has none. */
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [walking, setWalking] = useState(false);
  const [banner, setBanner] = useState<{
    variant: "success" | "danger";
    text: string;
  } | null>(null);

  const cursor = cursors[query.page - 1];
  const { result, query: request } = useCustom<FeedEntryAdminList>({
    url: feedSourcesUrl.entries(id, { limit: query.pageSize, cursor }),
    method: "get",
  });
  const page = result.data;
  const nextCursor = page?.nextCursor ?? null;
  // Keep the cursor of the page after this one, so «next» needs no walk.
  useEffect(() => {
    if (!nextCursor) return;
    setCursors((known) => {
      if (known[query.page] === nextCursor) return known;
      const next = known.slice(0, query.page);
      next[query.page] = nextCursor;
      return next;
    });
  }, [nextCursor, query.page]);

  async function goTo(next: AdminDataListQueryState<never>) {
    if (next.pageSize !== query.pageSize) {
      setCursors([undefined]);
      setQuery({ ...next, page: 1 });
      return;
    }
    if (next.page <= cursors.length) {
      setQuery(next);
      return;
    }
    // A jump past the known pages: read the pages in between for their cursors.
    setWalking(true);
    try {
      const known = [...cursors];
      const custom = dataProvider().custom!;
      while (known.length < next.page) {
        const from = known[known.length - 1];
        const res = await custom<FeedEntryAdminList>({
          url: feedSourcesUrl.entries(id, {
            limit: query.pageSize,
            cursor: from,
          }),
          method: "get",
        });
        const after = res.data.nextCursor;
        if (!after) break;
        known.push(after);
      }
      setCursors(known);
      setQuery({ ...next, page: Math.min(next.page, known.length) });
    } catch {
      setBanner({ variant: "danger", text: t("feedPosts.errors.loadFailed") });
    } finally {
      setWalking(false);
    }
  }

  function reread() {
    void request.refetch();
  }

  const source = page?.source;
  const platform = source?.platform ?? "telegram";
  const platformName = t(`feedSources.platforms.${platform}`);
  const address = source
    ? feedSourceAddressLabel(source.platform, source.address)
    : "";
  const notFound =
    request.isError &&
    (request.error as { statusCode?: number } | null)?.statusCode === 404;

  const columns: DataTableColumn<FeedEntryAdmin>[] = [
    {
      key: "kind",
      header: t("feedPosts.columns.kind"),
      width: "10%",
      fullValue: (row) => t(`feedPosts.kinds.${row.kind}`),
      render: (row) => (
        <span
          className="text-muted-foreground"
          data-testid={`feed-post-kind-${row.id}`}
        >
          {t(`feedPosts.kinds.${row.kind}`)}
        </span>
      ),
    },
    {
      key: "publishedAt",
      header: t("feedPosts.columns.publishedAt"),
      width: "18%",
      fullValue: (row) => formatMskDateTime(row.publishedAt),
      render: (row) => (
        <span
          className="text-muted-foreground"
          data-testid={`feed-post-date-${row.id}`}
        >
          {formatMskDateTime(row.publishedAt)}
        </span>
      ),
    },
    {
      key: "state",
      header: t("feedPosts.columns.state"),
      width: "18%",
      overflow: "wrap",
      render: (row) => (
        <StatusChip
          status={row.state}
          label={t(`feedPosts.states.${row.state}`)}
          testId={`feed-post-state-${row.id}`}
        />
      ),
    },
  ];

  return (
    <Authenticated key="feed-source-posts" redirectOnFail="/login">
      <AppShell>
        <div className="mb-4">
          <BackToList
            href="/materials/sources"
            label={t("feedSources.backToList")}
          />
        </div>
        {banner ? (
          <Alert
            variant={banner.variant}
            className="mb-4"
            data-testid={
              banner.variant === "success"
                ? "feed-post-notice"
                : "feed-post-error"
            }
          >
            {banner.text}
          </Alert>
        ) : null}
        <AdminDataList<FeedEntryAdmin, never>
          title={
            address
              ? `${t("feedPosts.title")} · ${address}`
              : t("feedPosts.title")
          }
          description={t("feedPosts.description", { address })}
          notice={source ? t(`feedPosts.note.${platform}`) : undefined}
          searchable={false}
          filterable={false}
          caption={t("feedPosts.tableCaption", { address })}
          record={{
            header: t("feedPosts.columns.text"),
            width: "36%",
            title: (row) => (
              <span
                className="line-clamp-1 break-words"
                data-testid={`feed-post-text-${row.id}`}
              >
                {row.text}
              </span>
            ),
            context: (row) => (
              <DsLink asChild>
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("feedPosts.openOriginalLabel", {
                    kind: t(`feedPosts.kindsInLabel.${row.kind}`),
                    date: formatMskDateTime(row.publishedAt),
                    platform: platformName,
                  })}
                  data-testid={`feed-post-original-${row.id}`}
                >
                  {t(`feedPosts.openOriginal.${platform}`)}
                </a>
              </DsLink>
            ),
            label: (row) => row.text,
          }}
          columns={columns}
          rows={page?.data ?? []}
          getRowKey={(row) => row.id}
          total={source?.entryCount ?? 0}
          isLoading={request.isLoading || walking}
          error={
            request.isError
              ? t(
                  notFound
                    ? "feedPosts.errors.sourceNotFound"
                    : "feedPosts.errors.loadFailed",
                )
              : null
          }
          query={query}
          onQueryChange={(next) => void goTo(next)}
          actionsHeader={t("feedPosts.columns.actions")}
          actions={(row) => (
            <FeedPostRowActions
              entry={row}
              platform={platform}
              dateLabel={formatMskDateTime(row.publishedAt)}
              onStarted={() => setBanner(null)}
              onChanged={(text) => {
                setBanner({ variant: "success", text });
                reread();
              }}
              onFailed={(text) => {
                setBanner({ variant: "danger", text });
                reread();
              }}
            />
          )}
          emptyTitle={t("feedPosts.empty")}
          emptyDescription={t(`feedPosts.emptyDescription.${platform}`)}
          testId="feed-posts"
        />
      </AppShell>
    </Authenticated>
  );
}

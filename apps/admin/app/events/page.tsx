"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Button } from "@ds/design-system";
import type { EventAdminListItem } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { StateBadge } from "@/components/state-badge";
import { formatMskDateTime } from "@/lib/msk";

/**
 * `EventAdminList` (design §8) — every event regardless of state, its lifecycle
 * badge, air date/time in МСК (EARS-10), and stream-config completeness. The
 * single source of truth (EARS-9): the `state` shown is exactly the
 * `EventLifecycleState` the 007 commands write and 004/005/006 read. Stock table
 * on DS tokens (EARS-11); copy from the RU catalog (EARS-10).
 */
export default function EventsListPage() {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const { result, query } = useList<EventAdminListItem>({
    resource: "events",
    pagination: { currentPage: page, pageSize },
  });
  const isLoading = query.isLoading;
  const rows = result.data ?? [];
  const pages = Math.max(1, Math.ceil((result.total ?? 0) / pageSize));

  return (
    <Authenticated key="events-list" redirectOnFail="/login">
      <AppShell>
        {/* Narrow viewports stack the heading above the create action; the
            single-row `justify-between` only holds from `sm` up, where the
            description text and the button no longer compete for the same
            line (#1222). */}
        <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-foreground">
              {t("events.listTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("events.listDescription")}
            </p>
          </div>
          <Button asChild data-testid="create-event">
            <Link href="/events/create">{t("events.createButton")}</Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="events-empty"
          >
            {t("events.empty")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto border-2 border-hairline">
              <table
                className="w-full border-collapse text-sm"
                data-testid="events-table"
              >
                <thead>
                  <tr className="border-b-2 border-hairline bg-card text-left">
                    <th className="px-4 py-3 font-bold">
                      {t("events.columns.title")}
                    </th>
                    <th className="px-4 py-3 font-bold">
                      {t("events.columns.school")}
                    </th>
                    <th className="px-4 py-3 font-bold">
                      {t("events.columns.startsAt")}
                    </th>
                    <th className="px-4 py-3 font-bold">
                      {t("events.columns.state")}
                    </th>
                    <th className="px-4 py-3 font-bold">
                      {t("events.columns.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-hairline"
                      data-testid={`event-row-${e.id}`}
                    >
                      <td className="px-4 py-3 font-semibold">{e.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {e.school}
                      </td>
                      <td className="px-4 py-3">
                        {formatMskDateTime(e.startsAt)} {t("events.mskSuffix")}
                      </td>
                      <td className="px-4 py-3">
                        <StateBadge state={e.state} />
                      </td>
                      <td className="px-4 py-3">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/events/${e.id}`}
                            data-testid={`edit-${e.id}`}
                          >
                            {t("events.edit")}
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav
              className="mt-4 flex items-center justify-between gap-3"
              aria-label={t("common.list.paginationNav")}
              data-testid="events-pagination"
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || query.isFetching}
                data-testid="events-previous"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t("common.list.previous")}
              </Button>
              <span className="text-sm text-muted-foreground">
                {t("common.list.pageReadout", { page, pages })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= pages || query.isFetching}
                data-testid="events-next"
                onClick={() =>
                  setPage((current) => Math.min(pages, current + 1))
                }
              >
                {t("common.list.next")}
              </Button>
            </nav>
          </>
        )}
      </AppShell>
    </Authenticated>
  );
}

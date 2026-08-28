"use client";

import { useState } from "react";
import Link from "next/link";
import { Authenticated, useList } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@ds/design-system";
import type { PartnerAdminListItem, TaxonomyStatus } from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_LIST_INITIAL_QUERY,
  AdminListShell,
  type AdminListQueryState,
} from "@/components/admin-list-shell";

/**
 * The partner list (012-design §5.1, EARS-4/EARS-15) on the SHARED admin list
 * shell — the same search / state filter / «показывать снятые с публикации»
 * toggle / pagination the project, expert and direction lists mount, with no shell
 * change: a partner list is a taxonomy list, and giving it its own copy would be
 * the drift #1297 later has to sweep.
 *
 * The website column shows the address itself rather than a link out: this is an
 * inventory of cards, and the operator opens the card to check the link in the
 * context it will be published in.
 */
export default function PartnersListPage() {
  const t = useTranslations();
  const [query, setQuery] = useState<AdminListQueryState>(
    ADMIN_LIST_INITIAL_QUERY,
  );
  const { result, query: request } = useList<PartnerAdminListItem>({
    resource: "partners",
    pagination: { currentPage: query.page, pageSize: query.pageSize },
    filters: [
      { field: "q", operator: "contains", value: query.q },
      { field: "status", operator: "eq", value: query.status },
      { field: "includeRetired", operator: "eq", value: query.includeRetired },
    ],
  });

  const statusLabels: Record<TaxonomyStatus, string> = {
    draft: t("partners.statuses.draft"),
    published: t("partners.statuses.published"),
    retired: t("partners.statuses.retired"),
  };

  return (
    <Authenticated key="partners-list" redirectOnFail="/login">
      <AppShell>
        <AdminListShell<PartnerAdminListItem>
          title={t("partners.listTitle")}
          description={t("partners.listDescription")}
          createHref="/partners/create"
          createLabel={t("partners.createButton")}
          statusLabels={statusLabels}
          columns={[
            { key: "title", label: t("partners.columns.title") },
            { key: "websiteUrl", label: t("partners.columns.websiteUrl") },
            { key: "slug", label: t("partners.columns.slug") },
            { key: "status", label: t("partners.columns.status") },
            { key: "actions", label: t("partners.columns.actions") },
          ]}
          rows={(result.data ?? []) as PartnerAdminListItem[]}
          total={result.total ?? 0}
          isLoading={request.isLoading}
          error={request.isError ? t("partners.errors.loadFailed") : null}
          query={query}
          onQueryChange={setQuery}
          emptyLabel={t("partners.empty")}
          testId="partners"
          renderRow={(row) => (
            <tr
              key={row.id}
              className="border-b border-hairline"
              data-testid={`partner-row-${row.id}`}
            >
              <td className="px-4 py-3 font-semibold">{row.title}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {row.websiteUrl ?? t("partners.notFilled")}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{row.slug}</td>
              <td className="px-4 py-3">
                {/* The DS Badge has one neutral tag variant (`label`) plus the
                    on-air `live` one; a lifecycle state is not "live", so every
                    status renders as the neutral tag and the WORD carries the
                    meaning. */}
                <Badge variant="label" data-testid={`status-${row.status}`}>
                  {statusLabels[row.status]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/partners/${row.id}`}
                    data-testid={`edit-${row.id}`}
                  >
                    {t("partners.edit")}
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

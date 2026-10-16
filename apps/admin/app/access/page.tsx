"use client";

import { useEffect, useState } from "react";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import type { DataTableColumn } from "@ds/design-system/blocks";
import { Button } from "@ds/design-system";
import {
  StaffAccessRowSchema,
  type StaffAccessListResponse,
  type StaffAccessRow,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import {
  StaffAccessGrantForm,
  type StaffAccessGrantResume,
} from "@/components/staff-access-grant-form";
import {
  StaffAccessRevokeDialog,
  type StaffAccessRevokeTarget,
} from "@/components/staff-access-revoke-dialog";
import {
  GRANT_FORM_EMPTY,
  STAFF_ACCESS_GRANTS_PATH,
  STAFF_ACCESS_PATH,
  STAFF_ACCESS_REVOCATIONS_PATH,
  staffAccessCells,
  staffAccessRowKey,
  type GrantFormFields,
  type StaffAccessCells,
} from "@/lib/staff-access";
import { adminCsrfToken } from "@/lib/admin-auth";
import { browserStepUpStorage, takeStepUpRequest } from "@/lib/step-up";
import { useAdminAccess } from "@/lib/use-admin-access";

/**
 * 047 EARS-1/EARS-2 — «Доступы»: every account holding a grantable staff role,
 * one row per person, role and event, on the `AdminDataList` composition the
 * congress roster uses (approved-non-canvas `feature-047-staff-access-v1`,
 * states `staff-access-nav` and `staff-access-list`). Platform administrator
 * only: the chrome draws the section for no one else (`lib/admin-access.ts`),
 * the shell refuses the route to anyone else, and the API refuses every
 * staff-access endpoint server-side.
 *
 * The list read (`GET /v1/admin/staff-access`) answers the whole set — a few
 * dozen staff — so the ФИО/почта search and the pager run over it here.
 *
 * «Выдать доступ» opens the grant panel (`StaffAccessGrantForm`); each row's
 * «Отозвать» opens the confirmation (`StaffAccessRevokeDialog`, 047 EARS-7). The
 * caller's own platform-administrator row draws it too: the session read the
 * console holds names roles, not the caller's account, so the API refusal
 * (`REVOKE_SELF_PLATFORM_ADMIN`) is what the dialog shows there.
 *
 * A grant or a revocation the step-up interrupted (047 EARS-8) comes back here
 * from the code screen. One saved request exists at a time, so it is read once
 * on load and routed by its path — to the panel, which restores the entered
 * values, or to the confirmation of the saved row — and sent again: only for
 * the session that saved it, after a confirmed code and within the replay
 * window (`lib/step-up.ts`); any other saved request is discarded.
 */
export default function StaffAccessPage() {
  const t = useTranslations();
  const access = useAdminAccess();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>(
    ADMIN_DATA_LIST_INITIAL_QUERY,
  );
  const [resume, setResume] = useState<StaffAccessGrantResume | null>(null);
  const [revoking, setRevoking] = useState<StaffAccessRevokeTarget | null>(
    null,
  );
  useEffect(() => {
    const saved = takeStepUpRequest(
      browserStepUpStorage(),
      [STAFF_ACCESS_GRANTS_PATH, STAFF_ACCESS_REVOCATIONS_PATH],
      { owner: adminCsrfToken(), now: Date.now() },
    );
    if (saved?.path === STAFF_ACCESS_REVOCATIONS_PATH) {
      const row = StaffAccessRowSchema.safeParse(saved.context.row);
      if (row.success) setRevoking({ row: row.data, replay: true });
      return;
    }
    const fields = saved?.context.fields as
      Partial<GrantFormFields> | undefined;
    if (!saved || typeof fields !== "object" || fields === null) return;
    setResume({
      fields: { ...GRANT_FORM_EMPTY, ...fields },
      eventLabel:
        typeof saved.context.eventLabel === "string"
          ? saved.context.eventLabel
          : null,
    });
  }, []);

  const { query: request } = useCustom<StaffAccessListResponse>({
    url: STAFF_ACCESS_PATH,
    method: "get",
    queryOptions: { enabled: access?.full === true },
  });
  const items = request.isError ? [] : (request.data?.data.items ?? []);

  type Row = StaffAccessRow & { key: string; cells: StaffAccessCells };
  const needle = query.q.trim().toLowerCase();
  const matching: Row[] = items
    .map((row) => ({
      ...row,
      key: staffAccessRowKey(row),
      cells: staffAccessCells(row),
    }))
    .filter(
      (row) =>
        !needle ||
        row.cells.fullName.toLowerCase().includes(needle) ||
        row.cells.email.toLowerCase().includes(needle),
    );
  const pageStart = (query.page - 1) * query.pageSize;
  const rows = matching.slice(pageStart, pageStart + query.pageSize);

  const textColumn = (
    key: "email" | "event",
    width: string,
  ): DataTableColumn<Row> => ({
    key,
    header: t(`staffAccess.columns.${key}`),
    width,
    overflow: "wrap",
    render: (row) => (
      <span data-testid={`staff-access-cell-${key}`}>{row.cells[key]}</span>
    ),
    fullValue: (row) => row.cells[key],
  });
  const columns: DataTableColumn<Row>[] = [
    textColumn("email", "28%"),
    {
      key: "role",
      header: t("staffAccess.columns.role"),
      width: "20%",
      render: (row) => (
        <span data-testid="staff-access-cell-role">{t(row.cells.roleKey)}</span>
      ),
      fullValue: (row) => t(row.cells.roleKey),
    },
    textColumn("event", "20%"),
    {
      key: "actions",
      header: t("staffAccess.columns.actions"),
      width: "12%",
      fullValue: () => t("staffAccess.revoke.trigger"),
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          data-testid={`staff-access-revoke-${row.key}`}
          onClick={() => {
            // The list item itself, not the display row: it is what the
            // step-up saves and reads back against the row schema.
            const item = items.find((i) => staffAccessRowKey(i) === row.key);
            if (item) setRevoking({ row: item, replay: false });
          }}
        >
          {t("staffAccess.revoke.trigger")}
        </Button>
      ),
    },
  ];

  return (
    <Authenticated key="staff-access" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          {access?.full ? (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-end">
              <StaffAccessGrantForm
                rows={items}
                resume={resume}
                onGranted={() => void request.refetch()}
              />
            </div>
          ) : null}
          <AdminDataList<Row, never>
            title={t("staffAccess.listTitle")}
            description={t("staffAccess.listDescription")}
            searchable
            searchLabel={t("staffAccess.searchLabel")}
            searchPlaceholder={t("staffAccess.searchPlaceholder")}
            filterable={false}
            caption={t("staffAccess.tableCaption")}
            record={{
              header: t("staffAccess.columns.fullName"),
              width: "20%",
              title: (row) => (
                <span data-testid={`staff-access-row-${row.key}`}>
                  {row.cells.fullName}
                </span>
              ),
              label: (row) => row.cells.fullName || row.cells.email,
            }}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.key}
            total={matching.length}
            isLoading={request.isLoading && request.fetchStatus !== "idle"}
            error={request.isError ? t("staffAccess.loadFailed") : null}
            query={query}
            onQueryChange={setQuery}
            emptyTitle={t("staffAccess.empty")}
            emptyDescription={t("staffAccess.emptyDescription")}
            testId="staff-access"
          />
          <StaffAccessRevokeDialog
            target={revoking}
            onClose={() => setRevoking(null)}
            onRevoked={() => void request.refetch()}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}

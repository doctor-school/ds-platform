"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Authenticated, useCustom } from "@refinedev/core";
import { useTranslations } from "next-intl";
import { KIND_COPY, STATUS_LABEL } from "@ds/congress-submissions";
import { Badge, Input, Label, NativeSelect } from "@ds/design-system";
import type { DataTableColumn } from "@ds/design-system/blocks";
import {
  CONGRESS_SUBMISSION_REGISTRY_SORTS,
  CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_DEFAULT,
  CongressRegistryStatusSchema,
  CongressSubmissionKindSchema,
  type CongressSubmissionRegistry,
  type CongressSubmissionRegistryRow,
} from "@ds/schemas";
import { AppShell } from "@/components/app-shell";
import { BackToList } from "@/components/back-to-list";
import { SubmissionCardPanel } from "@/components/submission-card-panel";
import {
  ADMIN_DATA_LIST_INITIAL_QUERY,
  AdminDataList,
  type AdminDataListQueryState,
} from "@/components/admin-data-list";
import {
  SUBMISSION_CARD_PARAM,
  SUBMISSION_REGISTRY_FILTER_INITIAL,
  submissionCardHref,
  submissionRegistryCells,
  submissionRegistryQuery,
  submissionSentRangeChips,
  type SubmissionRegistryCells,
  type SubmissionRegistryFilter,
} from "@/lib/congress-submissions";
import {
  participantCardNeighbour,
  pendingCardAnchor,
  queueCardRequest,
  settlePendingCards,
} from "@/lib/participant-card";
import { formatMskDateTime } from "@/lib/msk";
import { useAdminAccess } from "@/lib/use-admin-access";
import { congressSubmissionsUrl } from "@/providers/data-provider";

/** How long the submitter search waits for typing to settle (FilterBar's ≈400ms). */
const SUBMITTER_DEBOUNCE_MS = 400;

/**
 * 046 EARS-27 (#2437) — the event's congress submissions registry: the
 * `AdminDataList` composition of the 044 roster (Stage A route А, owner
 * 2026-10-08 on #2437), server-sorted, -filtered and -paged
 * (`GET /v1/admin/events/:id/congress-submissions`). Columns №, вид, тема,
 * подающий, статус, отправлена, изменена; № is the server's position in the
 * sorted, filtered listing. Drafts never come from the API — nothing is
 * filtered here.
 *
 * The facets — вид, статус, подающий (contains-search over name and email),
 * the send-date range — and the sort (every column but №, with its direction)
 * ride the list's filter bar as `extraFilters`; the list's own search is the
 * title and author-name search. Every one composes with the others and with
 * the page.
 *
 * EARS-28 — a row opens the submission card in the side `Sheet`
 * (`SubmissionCardPanel`); the open card lives in the address as
 * `?submission=<id>`, ↑/↓ walk the rows of the page, Esc returns focus to the
 * row — the participant card's mechanics, reused.
 */
export default function CongressSubmissionsPage() {
  const t = useTranslations("congressSubmissions");
  const params = useParams();
  const eventId = String(params.id);
  const access = useAdminAccess();
  const [query, setQuery] = useState<AdminDataListQueryState<never>>({
    ...ADMIN_DATA_LIST_INITIAL_QUERY,
    pageSize: CONGRESS_SUBMISSION_REGISTRY_PAGE_SIZE_DEFAULT,
  });
  const [filter, setFilter] = useState<SubmissionRegistryFilter>(
    SUBMISSION_REGISTRY_FILTER_INITIAL,
  );
  const changeFilter = (next: Partial<SubmissionRegistryFilter>) => {
    setFilter((current) => ({ ...current, ...next }));
    setQuery((current) => ({ ...current, page: 1 }));
  };
  // The submitter box is typed into; the query follows once typing settles.
  const [submitterText, setSubmitterText] = useState("");
  useEffect(() => {
    if (submitterText === filter.submitter) return;
    const timer = setTimeout(
      () => changeFilter({ submitter: submitterText }),
      SUBMITTER_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [submitterText, filter.submitter]);

  // The open card lives in the address (the participant card's mechanics).
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openSubmission = searchParams.get(SUBMISSION_CARD_PARAM);
  const lastOpened = useRef<string | null>(openSubmission);
  const pendingCards = useRef<(string | null)[]>([]);
  useEffect(() => {
    pendingCards.current = settlePendingCards(
      pendingCards.current,
      openSubmission,
    );
    if (openSubmission) lastOpened.current = openSubmission;
  }, [openSubmission]);
  const showCard = (submissionId: string | null) => {
    if (submissionId) lastOpened.current = submissionId;
    pendingCards.current = queueCardRequest(
      pendingCards.current,
      openSubmission,
      submissionId,
    );
    router.replace(
      submissionCardHref(pathname, searchParams.toString(), submissionId),
      { scroll: false },
    );
  };
  const cardContent = useRef<HTMLDivElement>(null);
  const showCardFromRow = (submissionId: string) => {
    showCard(submissionId);
    cardContent.current?.focus({ preventScroll: true });
  };

  const { query: request } = useCustom<CongressSubmissionRegistry>({
    url: congressSubmissionsUrl.list(
      eventId,
      submissionRegistryQuery(filter, query),
    ),
    method: "get",
  });
  const registry = request.isError ? undefined : request.data?.data;

  type Row = CongressSubmissionRegistryRow & { cells: SubmissionRegistryCells };
  const rows: Row[] = (registry?.rows ?? []).map((row) => ({
    ...row,
    cells: submissionRegistryCells(row),
  }));

  const textColumn = (
    key: keyof SubmissionRegistryCells,
    width: string,
  ): DataTableColumn<Row> => ({
    key,
    header: t(`columns.${key}`),
    width,
    render: (row) => (
      <span data-testid={`submissions-cell-${key}`}>{row.cells[key]}</span>
    ),
    fullValue: (row) => row.cells[key],
  });
  const columns: DataTableColumn<Row>[] = [
    {
      key: "kind",
      header: t("columns.kind"),
      width: "13%",
      render: (row) => (
        <span data-testid="submissions-cell-kind">
          {KIND_COPY[row.kind].label}
        </span>
      ),
      fullValue: (row) => KIND_COPY[row.kind].label,
    },
    textColumn("title", "27%"),
    textColumn("submitter", "17%"),
    {
      key: "status",
      header: t("columns.status"),
      width: "12%",
      render: (row) => (
        <span data-testid="submissions-cell-status">
          <Badge variant="label">{STATUS_LABEL[row.status]}</Badge>
        </span>
      ),
      fullValue: (row) => STATUS_LABEL[row.status],
    },
    textColumn("submittedAt", "12%"),
    textColumn("updatedAt", "12%"),
  ];

  const refetchRegistry = request.refetch;
  const registryStale = useCallback(
    () => void refetchRegistry(),
    [refetchRegistry],
  );
  const rowIds = rows.map((row) => row.id);
  const navigateCard = (direction: "prev" | "next") => {
    const anchor = pendingCardAnchor(pendingCards.current, openSubmission);
    if (!anchor) return;
    const next = participantCardNeighbour(rowIds, anchor, direction);
    if (next) showCard(next);
  };
  const returnFocusToRow = (event: Event) => {
    const id = lastOpened.current;
    if (!id) return;
    const control = Array.from(
      document.querySelectorAll<HTMLElement>(
        `[data-testid="submissions-row-${CSS.escape(id)}"]`,
      ),
    )
      .map((title) => title.closest("button"))
      .find((button) => button !== null && button.offsetParent !== null);
    if (!control) return;
    event.preventDefault();
    control.focus();
  };

  const kinds = CongressSubmissionKindSchema.options;
  const statuses = CongressRegistryStatusSchema.options;
  const facet = "flex flex-col gap-1.5 sm:w-48";
  const extraFilters = (
    <>
      <div className={facet}>
        <Label htmlFor="submissions-kind">{t("filters.kind")}</Label>
        <NativeSelect
          id="submissions-kind"
          value={filter.kind}
          data-testid="submissions-kind"
          onChange={(event) =>
            changeFilter({
              kind: event.target.value as SubmissionRegistryFilter["kind"],
            })
          }
        >
          <option value="">{t("filters.kindAny")}</option>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_COPY[kind].label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className={facet}>
        <Label htmlFor="submissions-status">{t("filters.status")}</Label>
        <NativeSelect
          id="submissions-status"
          value={filter.status}
          data-testid="submissions-status"
          onChange={(event) =>
            changeFilter({
              status: event.target.value as SubmissionRegistryFilter["status"],
            })
          }
        >
          <option value="">{t("filters.statusAny")}</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className={facet}>
        <Label htmlFor="submissions-submitter">{t("filters.submitter")}</Label>
        <Input
          id="submissions-submitter"
          value={submitterText}
          placeholder={t("filters.submitterPlaceholder")}
          data-testid="submissions-submitter"
          onChange={(event) => setSubmitterText(event.target.value)}
        />
      </div>
      <div className={facet}>
        <Label htmlFor="submissions-sent-from">{t("filters.sentFrom")}</Label>
        <Input
          id="submissions-sent-from"
          type="date"
          value={filter.sentFrom}
          data-testid="submissions-sent-from"
          onChange={(event) => changeFilter({ sentFrom: event.target.value })}
        />
      </div>
      <div className={facet}>
        <Label htmlFor="submissions-sent-to">{t("filters.sentTo")}</Label>
        <Input
          id="submissions-sent-to"
          type="date"
          value={filter.sentTo}
          data-testid="submissions-sent-to"
          onChange={(event) => changeFilter({ sentTo: event.target.value })}
        />
      </div>
      <div className={facet}>
        <Label htmlFor="submissions-sort">{t("filters.sort")}</Label>
        <NativeSelect
          id="submissions-sort"
          value={filter.sort}
          data-testid="submissions-sort"
          onChange={(event) =>
            changeFilter({
              sort: event.target.value as SubmissionRegistryFilter["sort"],
            })
          }
        >
          {CONGRESS_SUBMISSION_REGISTRY_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`columns.${sort}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className={facet}>
        <Label htmlFor="submissions-order">{t("filters.order")}</Label>
        <NativeSelect
          id="submissions-order"
          value={filter.order}
          data-testid="submissions-order"
          onChange={(event) =>
            changeFilter({
              order: event.target.value as SubmissionRegistryFilter["order"],
            })
          }
        >
          <option value="desc">{t("filters.orders.desc")}</option>
          <option value="asc">{t("filters.orders.asc")}</option>
        </NativeSelect>
      </div>
    </>
  );
  const extraApplied = [
    ...(filter.kind
      ? [
          {
            id: "kind",
            label: KIND_COPY[filter.kind].label,
            onRemove: () => changeFilter({ kind: "" }),
          },
        ]
      : []),
    ...(filter.status
      ? [
          {
            id: "status",
            label: STATUS_LABEL[filter.status],
            onRemove: () => changeFilter({ status: "" }),
          },
        ]
      : []),
    ...(filter.submitter
      ? [
          {
            id: "submitter",
            label: t("filters.chips.submitter", { value: filter.submitter }),
            onRemove: () => {
              setSubmitterText("");
              changeFilter({ submitter: "" });
            },
          },
        ]
      : []),
    // Only the bounds the query carries (an inverted range holds its end
    // back), each day as ДД.ММ.ГГГГ.
    ...submissionSentRangeChips(filter).map(({ id, day }) => ({
      id,
      label: t(`filters.chips.${id}`, { day }),
      onRemove: () => changeFilter({ [id]: "" }),
    })),
  ];

  return (
    <Authenticated key="congress-submissions" redirectOnFail="/login">
      <AppShell>
        <div className="flex flex-col gap-6">
          {/* The way back to the event detail exists only for a principal
              who may open it — a committee member may not. */}
          {access?.full ? (
            <BackToList href={`/events/${eventId}`} label={t("backToEvent")} />
          ) : null}
          <AdminDataList<Row, never>
            title={t("listTitle")}
            description={
              registry
                ? t("listDescription", {
                    title: registry.event.title,
                    date: formatMskDateTime(registry.event.startsAt),
                  })
                : t("loadingDescription")
            }
            searchable
            searchLabel={t("filters.search")}
            searchPlaceholder={t("filters.searchPlaceholder")}
            filterable={false}
            extraFilters={extraFilters}
            extraApplied={extraApplied}
            caption={t("tableCaption")}
            record={{
              header: t("columns.number"),
              width: "7%",
              title: (row) => (
                <span data-testid={`submissions-row-${row.id}`}>
                  {row.position}
                </span>
              ),
              label: (row) => row.cells.title,
            }}
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            onRowClick={(row) => showCardFromRow(row.id)}
            total={registry?.total ?? 0}
            isLoading={request.isLoading}
            error={request.isError ? t("errors.listFailed") : null}
            query={query}
            onQueryChange={setQuery}
            emptyTitle={t("empty")}
            emptyDescription={t("emptyDescription")}
            testId="submissions"
          />
          <SubmissionCardPanel
            eventId={eventId}
            submissionId={openSubmission}
            platformAdmin={access?.full ?? false}
            onClose={() => showCard(null)}
            onNavigate={navigateCard}
            onRegistryStale={registryStale}
            onCloseAutoFocus={returnFocusToRow}
            contentRef={cardContent}
          />
        </div>
      </AppShell>
    </Authenticated>
  );
}

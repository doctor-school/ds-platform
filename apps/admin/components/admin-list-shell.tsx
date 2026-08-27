"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button, Input, Label, NativeSelect, Switch } from "@ds/design-system";
import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  TAXONOMY_STATUSES,
  type TaxonomyStatus,
} from "@ds/schemas";

/**
 * The SHARED taxonomy admin list shell (012-design §5.1, §7; Stage A #1282
 * composition B). #1283 builds it once for projects; #1284–#1286 mount the same
 * component for experts / directions / partners, and #1297's cross-resource search
 * sweep tightens it in one place rather than in four copies.
 *
 * It owns exactly the four list controls the API exposes — free-text `q`, the
 * `status` filter, the «показывать снятые с публикации» toggle (default OFF, per
 * the owner's Stage-A answer 4) and page navigation — plus the loading, empty and
 * error states. It owns NO column knowledge: the caller passes `columns` and a
 * row renderer, so a resource's table stays that resource's business.
 *
 * The filter form is deliberately submit-driven, not keystroke-driven: each
 * submit is one server query with one `q`, which keeps the operator in control of
 * when the list moves and keeps a slow list from re-querying per character.
 */

export interface AdminListColumn {
  key: string;
  label: string;
  /** Right-align the actions column; everything else reads left. */
  align?: "left" | "right";
}

/**
 * The shell is generic over its STATUS VOCABULARY because the admin now lists two
 * different lifecycles through it: the three-state taxonomy lifecycle
 * (`draft`/`published`/`retired`) the 012 entities carry, and the two-state
 * relationship lifecycle (`active`/`retired`) the #1483 direction relations carry.
 * The alternative — a second shell for the two-state case — is precisely the drift
 * the header comment above rules out, and a shell hardcoded to the taxonomy triple
 * would offer a `draft` filter that a relation row can never be in.
 */
export interface AdminListQueryState<Status extends string = TaxonomyStatus> {
  q: string;
  status: Status | "";
  includeRetired: boolean;
  page: number;
  pageSize: number;
}

/**
 * Typed at `never` so the shared initial state is assignable to ANY status
 * vocabulary: `never | ""` is `""`, which every `Status | ""` accepts. One
 * constant therefore seeds a taxonomy list and a relation list alike, instead of
 * each caller re-typing the same five defaults.
 */
export const ADMIN_LIST_INITIAL_QUERY: AdminListQueryState<never> = {
  q: "",
  status: "",
  includeRetired: false,
  page: 1,
  pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
};

export function AdminListShell<Row, Status extends string = TaxonomyStatus>({
  title,
  description,
  createHref,
  createLabel,
  statusLabels,
  statuses,
  searchable = true,
  extraFilters,
  columns,
  rows,
  total,
  isLoading,
  error,
  query,
  onQueryChange,
  renderRow,
  emptyLabel,
  testId,
}: {
  title: string;
  description: string;
  createHref: string;
  createLabel: string;
  /** RU label per lifecycle state — the shell renders no domain vocabulary itself. */
  statusLabels: Record<Status, string>;
  /** The lifecycle this resource actually has; defaults to the 012 taxonomy triple. */
  statuses?: readonly Status[];
  /**
   * Whether the resource's list route accepts free-text `q`. The direction
   * relations do not (their list queries are `.strict()` and scope by endpoint id
   * instead), and rendering a search box the API would reject is the same broken
   * promise a placeholder field for an unsupported column would be.
   */
  searchable?: boolean;
  /** Resource-specific filter controls rendered alongside the shared ones. */
  extraFilters?: ReactNode;
  columns: AdminListColumn[];
  rows: Row[];
  total: number;
  isLoading: boolean;
  error?: string | null;
  query: AdminListQueryState<Status>;
  onQueryChange: (next: AdminListQueryState<Status>) => void;
  renderRow: (row: Row) => ReactNode;
  emptyLabel: string;
  testId: string;
}) {
  const t = useTranslations();
  // Draft state so typing does not re-query per keystroke; committed on submit.
  const [draftQ, setDraftQ] = useState(query.q);
  const pages = Math.max(1, Math.ceil(total / query.pageSize));

  return (
    <div>
      {/* Same narrow-viewport stacking as the events list (#1222): the create
          action drops below the heading until `sm`, where the two stop
          competing for one line. */}
      <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button asChild data-testid={`${testId}-create`}>
          <a href={createHref}>{createLabel}</a>
        </Button>
      </div>

      <form
        className="mb-5 flex flex-col gap-4 border-2 border-hairline bg-card p-4 sm:flex-row sm:items-end"
        data-testid={`${testId}-filters`}
        onSubmit={(event) => {
          event.preventDefault();
          onQueryChange({ ...query, q: draftQ.trim(), page: 1 });
        }}
      >
        {searchable ? (
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={`${testId}-q`}>{t("projects.filters.search")}</Label>
            <Input
              id={`${testId}-q`}
              value={draftQ}
              placeholder={t("projects.filters.searchPlaceholder")}
              data-testid={`${testId}-search`}
              onChange={(event) => setDraftQ(event.target.value)}
            />
          </div>
        ) : null}
        {extraFilters}
        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor={`${testId}-status`}>
            {t("projects.filters.status")}
          </Label>
          <NativeSelect
            id={`${testId}-status`}
            value={query.status}
            data-testid={`${testId}-status`}
            onChange={(event) =>
              onQueryChange({
                ...query,
                status: event.target.value as Status | "",
                page: 1,
              })
            }
          >
            <option value="">{t("projects.filters.statusAny")}</option>
            {(statuses ?? (TAXONOMY_STATUSES as readonly string[] as readonly Status[])).map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex items-center sm:pb-3">
          {/* The DS Switch wraps its own <label>, so the visible text is its
              child rather than a sibling <Label> — a second label element would
              give the same control two accessible names. */}
          <Switch
            id={`${testId}-include-retired`}
            checked={query.includeRetired}
            data-testid={`${testId}-include-retired`}
            onChange={(event) =>
              onQueryChange({
                ...query,
                includeRetired: event.target.checked,
                page: 1,
              })
            }
          >
            {t("projects.filters.includeRetired")}
          </Switch>
        </div>
        <Button type="submit" variant="secondary" data-testid={`${testId}-apply`}>
          {t("common.apply")}
        </Button>
      </form>

      {error ? (
        <p className="text-sm text-destructive" data-testid={`${testId}-error`}>
          {error}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`${testId}-empty`}
        >
          {emptyLabel}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border-2 border-hairline">
            <table
              className="w-full border-collapse text-sm"
              data-testid={`${testId}-table`}
            >
              <thead>
                <tr className="border-b-2 border-hairline bg-card text-left">
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-3 font-bold ${
                        column.align === "right" ? "text-right" : ""
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows.map((row) => renderRow(row))}</tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span data-testid={`${testId}-total`}>
              {t("projects.pagination.total", { total })}
            </span>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={query.page <= 1}
                data-testid={`${testId}-prev`}
                onClick={() =>
                  onQueryChange({ ...query, page: Math.max(1, query.page - 1) })
                }
              >
                {t("projects.pagination.previous")}
              </Button>
              <span data-testid={`${testId}-page`}>
                {t("projects.pagination.page", { page: query.page, pages })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={query.page >= pages}
                data-testid={`${testId}-next`}
                onClick={() =>
                  onQueryChange({
                    ...query,
                    page: Math.min(pages, query.page + 1),
                  })
                }
              >
                {t("projects.pagination.next")}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

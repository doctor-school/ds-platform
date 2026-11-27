import {
  AdminApplicationErrorCodes,
  APPLICATION_STATUSES,
  type AdminApplicationDetail,
  type AdminApplicationKindOption,
  type ApplicationKind,
  type ApplicationOutcome,
  type ApplicationStatus,
} from "@ds/schemas";
import type { AdminListCursor } from "./admin-list-pager";

/**
 * 033 EARS-13…EARS-17, EARS-20 — the pure projections behind «Заявки»
 * (`app/applications/**`): the routes, what a status reads as, which commands
 * an application offers and how each refusal reads. The pages are thin mounts;
 * the decisions live here so the Node-only unit tier pins them.
 */

/** The admin section route. */
export const APPLICATIONS_ROUTE = "/applications";

const BASE = "/v1/admin/applications";

export interface ApplicationsListQuery {
  kind?: ApplicationKind | "";
  status?: ApplicationStatus | "";
  cursor?: string;
  limit: number;
}

/**
 * The `/v1/admin/applications*` routes, built in one place. An empty filter is
 * OMITTED: the list query is `.strict()` on closed vocabularies, so `status=`
 * would be a 400, never «any status».
 */
export const applicationsUrl = {
  list(query: ApplicationsListQuery): string {
    const params = new URLSearchParams();
    if (query.kind) params.set("kind", query.kind);
    if (query.status) params.set("status", query.status);
    if (query.cursor) params.set("cursor", query.cursor);
    params.set("limit", String(query.limit));
    return `${BASE}?${params.toString()}`;
  },
  detail: (id: string) => `${BASE}/${id}`,
  status: (id: string) => `${BASE}/${id}/status`,
  notes: (id: string) => `${BASE}/${id}/notes`,
  erase: (id: string) => `${BASE}/${id}/erase-personal-data`,
};

/**
 * 034 EARS-10 — the «Вид» filter's options: every kind the api serves, offered
 * by its filter text (`filterLabel`, «Инвесторы»), while the rows keep the
 * kind label ({@link kindOptionLabel}, «Инвестор»).
 */
export function kindFilterOptions(
  kinds: readonly AdminApplicationKindOption[],
): { value: ApplicationKind; text: string }[] {
  return kinds.map((k) => ({ value: k.kind, text: k.filterLabel }));
}

/**
 * «Вид» — the label of a kind as the api serves it with every page
 * (`kinds`), the same kinds-table label the rows carry (033-design «Request
 * kinds»); the bare kind until a page has come.
 */
export function kindOptionLabel(
  kinds: readonly AdminApplicationKindOption[],
  kind: ApplicationKind,
): string {
  return kinds.find((k) => k.kind === kind)?.label ?? kind;
}

/** «Статус» — «Новые» / «На рассмотрении» / «Закрытые». */
export const APPLICATION_STATUS_FILTERS: readonly ApplicationStatus[] =
  APPLICATION_STATUSES;

/**
 * What a status cell says: an open application its status, a closed one its
 * outcome («Принята» / «Отклонена» / «Истекла»).
 */
export function applicationStatusLabelKey(
  status: ApplicationStatus,
  outcome: ApplicationOutcome | null,
): string {
  if (status === "closed" && outcome) return `applications.outcome.${outcome}`;
  return `applications.status.${status}`;
}

export interface ApplicationActions {
  /** «Взять в работу» — `new → in_review`. */
  takeIntoWork: boolean;
  /** «Закрыть» — `new | in_review → closed` with an outcome. */
  close: boolean;
  /** «Добавить заметку» — an erased application takes no note (409). */
  addNote: boolean;
  /** «Стереть персональные данные заявителя» — once only (409 ALREADY_ERASED). */
  erase: boolean;
}

/** The commands an application offers, by the EARS-15 transitions. */
export function applicationActions(
  detail: Pick<AdminApplicationDetail, "status" | "erased">,
): ApplicationActions {
  return {
    takeIntoWork: detail.status === "new",
    close: detail.status !== "closed",
    addNote: !detail.erased,
    erase: !detail.erased,
  };
}

export type ApplicationRefusal =
  | "stale"
  | "alreadyErased"
  | "transitionNotAllowed"
  | "forbidden"
  | "notFound"
  | "invalid"
  | "unavailable"
  | "generic";

/**
 * How a refused command reads. `412` is the stale version (someone changed the
 * application meanwhile — reload, nothing changed); the two `409`s are told
 * apart by their code. No answer at all, or a `502`/`503`/`504`, is the API
 * being unreachable.
 */
export function applicationRefusal(error: unknown): ApplicationRefusal {
  const refusal = error as
    { statusCode?: unknown; errorCode?: unknown } | undefined;
  const status =
    typeof refusal?.statusCode === "number" ? refusal.statusCode : 0;
  const code =
    typeof refusal?.errorCode === "string" ? refusal.errorCode : undefined;
  if (status === 412) return "stale";
  if (status === 409 && code === AdminApplicationErrorCodes.alreadyErased)
    return "alreadyErased";
  if (
    status === 409 &&
    code === AdminApplicationErrorCodes.transitionNotAllowed
  )
    return "transitionNotAllowed";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 400) return "invalid";
  if (status === 0 || status === 502 || status === 503 || status === 504)
    return "unavailable";
  return "generic";
}

/**
 * The cursor pager: a page before the current one exists from page 2 on, and
 * the next one exists while its cursor is remembered or the current page names
 * one. The API counts nothing, so the pager claims no total at all.
 */
export function applicationsCursorPager(
  known: readonly (string | undefined)[],
  page: number,
  nextCursor: string | null,
): AdminListCursor {
  return {
    hasPrevious: page > 1,
    hasNext: known.length > page || nextCursor !== null,
  };
}

/**
 * Keeps the cursor of the page after `page` (`known[p - 1]` reads page `p`).
 * A cursor that differs from the remembered one means the list moved, so the
 * pages beyond it are forgotten rather than read with stale cursors.
 */
export function rememberNextCursor(
  known: (string | undefined)[],
  page: number,
  nextCursor: string | null,
): (string | undefined)[] {
  if (!nextCursor) return known;
  if (known[page] === nextCursor) return known;
  const next = known.slice(0, page);
  next[page] = nextCursor;
  return next;
}

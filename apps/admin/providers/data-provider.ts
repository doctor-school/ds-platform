"use client";

import type { DataProvider, HttpError } from "@refinedev/core";
import type { components } from "@ds/api-client";
import { adminCsrfHeaders } from "@/lib/admin-auth";
import {
  ADMIN_LIST_PAGE_SIZE_MAX,
  LIFECYCLE_IMPACT_TOKEN_HEADER,
} from "@ds/schemas";
import type {
  TaxonomyLifecycleTransition,
  AttachRecordingRequest,
  ConfigureStreamRequest,
  CreateEventExpertRequest,
  CreateEventRequest,
  CreateExpertRequest,
  CreatePartnerRequest,
  CreateProjectRequest,
  EventAdminDetail,
  EventAdminListItem,
  ExpertAdminDetail,
  ExpertAdminListItem,
  PartnerAdminDetail,
  PartnerAdminListItem,
  ProjectAdminDetail,
  ProjectAdminListItem,
  CreateDirectionRequest,
  RecordingCommand,
  RelationshipStatus,
  TaxonomyStatus,
  DirectionAdminDetail,
  DirectionAdminListItem,
  UpdateEventExpertRequest,
  UpdateEventRequest,
  UpdateExpertRequest,
  UpdatePartnerRequest,
  UpdateProjectRequest,
  UpdateRecordingRequest,
  UpdateDirectionRequest,
} from "@ds/schemas";

/**
 * Custom Refine REST data provider over the NestJS admin surface (ADR-0004 §5
 * — Refine + custom REST data provider). Every call hits the RELATIVE `/v1/admin/*`
 * path with `credentials: "include"`, so it rides the admin's own origin and the
 * `__Host-ds_admin_session` cookie the 011 admin tier issued (proxied to the api
 * by `next.config.ts` `rewrites()`). No absolute api URL, no token in JS.
 *
 * **Every state-changing call carries the EARS-10 CSRF double-submit header.**
 * Since 011 an admin route refuses a POST/PATCH/PUT/DELETE whose
 * `x-ds-admin-csrf` header does not match the readable `__Host-ds_admin_csrf`
 * cookie — `SameSite=Strict` already makes a cross-site write hard to reach, and
 * the double-submit is the defence-in-depth ADR-0004 design §3.2.1 asks for on
 * top of it. Reads owe no proof and send none.
 *
 * Two CRUD resources plus one command sub-resource. `recordings` (014) is
 * deliberately NOT a Refine CRUD resource — it hangs off an event, its writes are
 * named §3 commands, and its list body carries event facts a `getList` contract
 * would truncate; it rides `custom`, which also owns its EARS-17 protocol headers.
 *
 *   events   (007)  getList → GET /v1/admin/events; create/update multipart;
 *                   custom  → stream config + the named lifecycle transitions.
 *   projects (012)  getList → GET /v1/admin/projects?page&pageSize&q&status&includeRetired
 *                   getOne  → GET /v1/admin/projects/:id (captures the ETag)
 *                   create  → POST  (Idempotency-Key; JSON or multipart+cover)
 *                   update  → PATCH (Idempotency-Key + If-Match)
 *
 *   experts  (012)  the same four calls against /v1/admin/experts, with `photo`
 *                   as the file part instead of `cover` (#1284, EARS-2).
 *
 *   partners (012)  the same four calls against /v1/admin/partners, with `logo`
 *                   as the file part (#1286, EARS-4).
 *
 *   directions   (012)  the same four calls against /v1/admin/directions, with NO file
 *                   part at all — a direction is a title plus its address, so every
 *                   write is JSON (#1285, EARS-3).
 *
 * `deleteOne` throws for EVERY resource: 012 has no Delete route anywhere in the
 * taxonomy controller and 007's lifecycle is archive, never destroy. The provider
 * is the last place a stray Refine `useDelete()` could reach, so the refusal
 * lives here rather than relying on no page rendering the control.
 */
const ADMIN_BASE = "/v1/admin";

/** Variables the create form hands the provider — the authored aggregate + an optional PDF. */
export type CreateEventVars = CreateEventRequest & { programPdf?: File | null };
/** Variables the edit form hands the provider — a partial aggregate + an optional replacement PDF. */
export type UpdateEventVars = UpdateEventRequest & { programPdf?: File | null };

/**
 * The 012 taxonomy resources this provider serves, and the multipart file part
 * each one's image rides in (012-design §5.1). The map is the single place a new
 * vertical (#1285/#1286) registers itself: every call below dispatches off it, so
 * a resource cannot be half-wired — listed here means list/detail/create/update
 * all work for it.
 */
const TAXONOMY_MEDIA_PART = {
  projects: "cover",
  experts: "photo",
  // A partner's image is its LOGO, and the part name is kind-specific by design
  // (012-design §5.1): sending it as `cover`/`photo` is a 400, not a synonym.
  partners: "logo",
  // A direction carries no image anywhere in the entity (012-design §2.2 / §5.1): it
  // is a title plus its permanent address. `null` registers the resource on this
  // map — so list/detail/create/update all dispatch for it — WITHOUT inventing a
  // file part the API has no route for; its writes are always JSON (#1285).
  directions: null,
} as const;
type TaxonomyResource = keyof typeof TAXONOMY_MEDIA_PART;

function isTaxonomyResource(resource: string): resource is TaxonomyResource {
  return Object.hasOwn(TAXONOMY_MEDIA_PART, resource);
}

/** Project create variables: the authored fields plus an optional cover file. */
export type CreateProjectVars = CreateProjectRequest & { cover?: File | null };
/**
 * Project edit variables. `cover` sets/replaces; `mediaAction: "clear"` removes;
 * supplying both is refused by the API with `MEDIA_INPUT_CONFLICT`, so the form
 * must never offer both at once. `version` becomes the `If-Match` precondition.
 */
export type UpdateProjectVars = UpdateProjectRequest & {
  cover?: File | null;
  version: number;
};

/** Expert create variables: the authored fields plus an optional photo file (#1284). */
export type CreateExpertVars = CreateExpertRequest & { photo?: File | null };
/**
 * Expert edit variables. `photo` sets/replaces the stored photo; `mediaAction:
 * "clear"` removes it; supplying both is refused by the API with
 * `MEDIA_INPUT_CONFLICT`, so the form never offers both at once. `version`
 * becomes the `If-Match` precondition.
 */
export type UpdateExpertVars = UpdateExpertRequest & {
  photo?: File | null;
  version: number;
};

export type EligibleExpertUserList =
  components["schemas"]["EligibleExpertUserListDto"];
export type EligibleExpertUserOption = EligibleExpertUserList["data"][number];

/** Partner create variables: the authored fields plus an optional logo file (#1286). */
export type CreatePartnerVars = CreatePartnerRequest & { logo?: File | null };
/**
 * Partner edit variables. `logo` sets/replaces the stored logo; `mediaAction:
 * "clear"` removes it; supplying both is refused by the API with
 * `MEDIA_INPUT_CONFLICT`, so the form never offers both at once. `version`
 * becomes the `If-Match` precondition.
 */
export type UpdatePartnerVars = UpdatePartnerRequest & {
  logo?: File | null;
  version: number;
};

/** Direction create variables: the authored fields, and nothing else — no media part (#1285). */
export type CreateDirectionVars = CreateDirectionRequest;
/** Direction edit variables. `version` becomes the `If-Match` precondition. */
export type UpdateDirectionVars = UpdateDirectionRequest & { version: number };

/** The taxonomy detail projections this provider can return. */
type TaxonomyDetail =
  | ProjectAdminDetail
  | ExpertAdminDetail
  | PartnerAdminDetail
  | DirectionAdminDetail;
/** The taxonomy list rows this provider can return. */
type TaxonomyListItem =
  | ProjectAdminListItem
  | ExpertAdminListItem
  | PartnerAdminListItem
  | DirectionAdminListItem;

/**
 * The file part of a taxonomy write, resolved off the resource map. A resource
 * registered with `null` (directions) has no file part at all, so no variable of the
 * write can ever be read as one.
 */
function taxonomyFile(
  resource: TaxonomyResource,
  files: { cover?: File | null; photo?: File | null; logo?: File | null },
): File | null | undefined {
  const part = TAXONOMY_MEDIA_PART[resource];
  return part ? files[part] : null;
}

/** RFC 7807 problem body of the 012 surface — the stable `errorCode` is the contract. */
export interface TaxonomyHttpError extends HttpError {
  errorCode?: string;
  traceId?: string;
  fieldErrors?: { path: string; message: string }[];
}

async function toHttpError(res: Response): Promise<TaxonomyHttpError> {
  let message = `Запрос завершился ошибкой (${res.status})`;
  let errorCode: string | undefined;
  let traceId: string | undefined;
  let fieldErrors: { path: string; message: string }[] | undefined;
  try {
    const body = (await res.json()) as {
      message?: unknown;
      detail?: unknown;
      title?: unknown;
      errorCode?: unknown;
      traceId?: unknown;
      errors?: unknown;
    };
    if (typeof body.message === "string") message = body.message;
    else if (typeof body.detail === "string") message = body.detail;
    else if (typeof body.title === "string") message = body.title;
    if (typeof body.errorCode === "string") errorCode = body.errorCode;
    if (typeof body.traceId === "string") traceId = body.traceId;
    if (Array.isArray(body.errors)) {
      fieldErrors = body.errors as { path: string; message: string }[];
    }
  } catch {
    // Non-JSON / empty body — keep the generic message.
  }
  return {
    message,
    statusCode: res.status,
    ...(errorCode ? { errorCode } : {}),
    ...(traceId ? { traceId } : {}),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

/** One bounded server page for the EARS-19 User selector. */
export async function fetchEligibleExpertUsers({
  currentExpertId,
  q = "",
  page = 1,
  pageSize = 25,
}: {
  currentExpertId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<EligibleExpertUserList> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (q.trim()) params.set("q", q.trim());
  if (currentExpertId) params.set("currentExpertId", currentExpertId);
  const res = await fetch(
    `${ADMIN_BASE}/experts/eligible-users?${params.toString()}`,
    { credentials: "include", headers: { accept: "application/json" } },
  );
  if (!res.ok) throw await toHttpError(res);
  return (await res.json()) as EligibleExpertUserList;
}

/**
 * One bounded server page for a relationship endpoint selector (EARS-22/23). It
 * is the same relative, cookie-authenticated GET the Refine `custom` path makes —
 * a read owes no CSRF proof — expressed as a plain promise so the shared
 * `useServerCombobox` owns the paging/debounce state for every selector alike.
 */
export async function fetchRelationshipEndpointOptions({
  resource,
  q = "",
  page = 1,
  pageSize = 20,
}: {
  resource: "events" | "projects" | "experts" | "directions" | "partners";
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  data: { id: string; title?: string; name?: string | null }[];
  total: number;
  page: number;
}> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (q.trim()) params.set("q", q.trim());
  const res = await fetch(`${ADMIN_BASE}/${resource}?${params.toString()}`, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw await toHttpError(res);
  const body = (await res.json()) as {
    data: { id: string; title?: string; name?: string | null }[];
    total: number;
    page?: number;
  };
  return { data: body.data, total: body.total, page: body.page ?? page };
}

/** Split the authoring variables into the JSON payload and the file part. */
function toAuthoringForm(vars: CreateEventVars | UpdateEventVars): FormData {
  const { programPdf, ...payload } = vars;
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  if (programPdf) form.append("programPdf", programPdf);
  return form;
}

/**
 * A fresh canonical lowercase UUID per mutation (012-design §6). Generated per
 * CALL, not per form mount: a second submit is a second logical request, and
 * reusing the key would replay the first response instead of applying the edit.
 */
function idempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * The taxonomy write body. JSON is the canonical no-file shape; an image rides
 * `multipart/form-data` with exactly one `payload` part plus one file part named
 * for the resource — `cover` for a project, `photo` for an expert (012-design
 * §5.1). A multipart body with no file is refused with 415, so the shape is
 * chosen by whether a file exists — never "multipart always".
 */
function taxonomyBody(
  resource: TaxonomyResource,
  payload: Record<string, unknown>,
  file: File | null | undefined,
): { body: BodyInit; headers: Record<string, string> } {
  const part = TAXONOMY_MEDIA_PART[resource];
  if (file && part) {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    form.append(part, file);
    // No explicit content-type: the browser sets it WITH the boundary.
    return { body: form, headers: {} };
  }
  return {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  };
}

/** The admin list query of a taxonomy resource (012-design §5.1). */
function taxonomyListQuery(params: {
  pagination?: { currentPage?: number; pageSize?: number };
  filters?: readonly { field?: string; value?: unknown }[];
}): string {
  const query = new URLSearchParams();
  query.set("page", String(params.pagination?.currentPage ?? 1));
  query.set("pageSize", String(params.pagination?.pageSize ?? 20));
  for (const filter of params.filters ?? []) {
    const value = filter.value;
    if (filter.field === "q" && typeof value === "string" && value.length > 0) {
      query.set("q", value);
    }
    if (filter.field === "status" && typeof value === "string" && value) {
      query.set("status", value as TaxonomyStatus);
    }
    if (filter.field === "includeRetired" && value === true) {
      query.set("includeRetired", "true");
    }
  }
  return query.toString();
}

export const dataProvider: DataProvider = {
  getApiUrl: () => ADMIN_BASE,

  getList: async ({ resource, pagination, filters }) => {
    if (isTaxonomyResource(resource)) {
      const res = await fetch(
        `${ADMIN_BASE}/${resource}?${taxonomyListQuery({
          ...(pagination ? { pagination } : {}),
          ...(filters ? { filters } : {}),
        })}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!res.ok) throw await toHttpError(res);
      const body = (await res.json()) as {
        data: TaxonomyListItem[];
        total: number;
      };
      return { data: body.data as unknown as never[], total: body.total };
    }
    if (resource !== "events") throw new Error(`unknown resource: ${resource}`);
    const eventQuery = taxonomyListQuery({
      ...(pagination ? { pagination } : {}),
      ...(filters ? { filters } : {}),
    });
    const res = await fetch(`${ADMIN_BASE}/events?${eventQuery}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw await toHttpError(res);
    const body = (await res.json()) as {
      data: EventAdminListItem[];
      total: number;
    };
    return { data: body.data as unknown as never[], total: body.total };
  },

  getOne: async ({ resource, id }) => {
    if (isTaxonomyResource(resource)) {
      const res = await fetch(`${ADMIN_BASE}/${resource}/${id}`, {
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw await toHttpError(res);
      const data = (await res.json()) as TaxonomyDetail;
      return { data: data as unknown as never };
    }
    if (resource !== "events") throw new Error(`unknown resource: ${resource}`);
    const res = await fetch(`${ADMIN_BASE}/events/${id}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },

  create: async ({ resource, variables }) => {
    if (isTaxonomyResource(resource)) {
      const { cover, photo, logo, ...payload } =
        variables as CreateProjectVars &
          CreateExpertVars &
          CreatePartnerVars &
          CreateDirectionVars;
      const { body, headers } = taxonomyBody(
        resource,
        payload as Record<string, unknown>,
        taxonomyFile(resource, { cover, photo, logo }),
      );
      const res = await fetch(`${ADMIN_BASE}/${resource}`, {
        method: "POST",
        credentials: "include",
        headers: {
          ...headers,
          accept: "application/json",
          "idempotency-key": idempotencyKey(),
          ...adminCsrfHeaders(),
        },
        body,
      });
      if (!res.ok) throw await toHttpError(res);
      const data = (await res.json()) as TaxonomyDetail;
      return { data: data as unknown as never };
    }
    if (resource !== "events") throw new Error(`unknown resource: ${resource}`);
    const res = await fetch(`${ADMIN_BASE}/events`, {
      method: "POST",
      credentials: "include",
      headers: adminCsrfHeaders(),
      body: toAuthoringForm(variables as CreateEventVars),
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },

  update: async ({ resource, id, variables }) => {
    if (isTaxonomyResource(resource)) {
      const { cover, photo, logo, version, ...payload } =
        variables as UpdateProjectVars &
          UpdateExpertVars &
          UpdatePartnerVars &
          UpdateDirectionVars;
      const { body, headers } = taxonomyBody(
        resource,
        payload as Record<string, unknown>,
        taxonomyFile(resource, { cover, photo, logo }),
      );
      const res = await fetch(`${ADMIN_BASE}/${resource}/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          ...headers,
          accept: "application/json",
          "idempotency-key": idempotencyKey(),
          // The optimistic-concurrency precondition (012-design §6): the version
          // the form was rendered from. A stale one is a 412, never a lost edit.
          "if-match": `W/"${version}"`,
          ...adminCsrfHeaders(),
        },
        body,
      });
      if (!res.ok) throw await toHttpError(res);
      const data = (await res.json()) as TaxonomyDetail;
      return { data: data as unknown as never };
    }
    if (resource !== "events") throw new Error(`unknown resource: ${resource}`);
    const res = await fetch(`${ADMIN_BASE}/events/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: adminCsrfHeaders(),
      body: toAuthoringForm(variables as UpdateEventVars),
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },

  deleteOne: async ({ resource }) => {
    // 012 exposes no DELETE route anywhere in the taxonomy controller, and 007's
    // lifecycle is archive, never destroy (012-design §5.1, EARS-14).
    throw new Error(`delete is not supported for ${resource}`);
  },

  /**
   * The non-CRUD commands: feature 007's stream-config write (EARS-3) and named
   * lifecycle transitions (EARS-4/5/6), and feature 014's whole recordings
   * sub-resource (`/v1/admin/events/:id/recordings*`, 014-design §10).
   *
   * Recordings are NOT a Refine CRUD resource on purpose. They are a sub-resource
   * of an event with named commands (`publish` / `unpublish` / `retire` /
   * `restore`) and a list response that carries event facts alongside the rows
   * (`eventState`, `recordingExpectedBy`) — a shape `getList` would truncate to
   * `{ data, total }`. So they ride this path, which returns the response body
   * whole.
   *
   * **The 014 EARS-17 protocol headers are OWNED HERE, not at the call site.**
   * Every mutating recordings request must carry a canonical `Idempotency-Key`,
   * and every non-create must carry `If-Match`. Generating the key in the
   * provider is what makes it correct: a fresh key per CALL is the point (a
   * second submit is a second logical request, and a key hoisted into a
   * component would replay the first response instead of applying the edit).
   * The caller supplies only the row `version` it rendered from, via
   * `meta.version`; a stale one comes back as 412, never as a lost edit.
   */
  custom: async ({ url, method, payload, meta }) => {
    const hasBody = payload !== undefined && method !== "get";
    const mutating = method !== "get";
    const { version, impactToken } =
      (meta as { version?: number; impactToken?: string } | undefined) ?? {};
    const res = await fetch(url, {
      method: (method ?? "post").toUpperCase(),
      credentials: "include",
      // A `get` through `custom` is a read and owes no CSRF proof; everything
      // else on this path is a state-changing admin command (EARS-10).
      headers: {
        ...(hasBody
          ? { "content-type": "application/json", accept: "application/json" }
          : { accept: "application/json" }),
        ...(mutating ? { "idempotency-key": idempotencyKey() } : {}),
        ...(mutating && typeof version === "number"
          ? { "if-match": `W/"${version}"` }
          : {}),
        // The §3.1 confirmation envelope. It is NOT generated here (unlike the
        // idempotency key): it is the signed answer to a preview the operator
        // has just READ, so only the dialog that showed the affected rows can
        // supply it. Absent → 428, stale → 412; both are refusals the caller
        // must render, never something this seam papers over.
        ...(mutating && typeof impactToken === "string"
          ? { [LIFECYCLE_IMPACT_TOKEN_HEADER]: impactToken }
          : {}),
        ...(method === "get" ? {} : adminCsrfHeaders()),
      },
      body: hasBody
        ? JSON.stringify(
            payload as
              | ConfigureStreamRequest
              | AttachRecordingRequest
              | UpdateRecordingRequest
              | CreateEventExpertRequest
              | UpdateEventExpertRequest
              | undefined,
          )
        : undefined,
    });
    if (!res.ok) throw await toHttpError(res);
    // 007 transitions answer with an `EventAdminDetail`; the 014 routes answer
    // with a `RecordingAdminList` (GET) or a `RecordingAdminDetail` (writes).
    // The caller types the body it asked for — this seam stays shape-agnostic.
    const data = (await res.json()) as unknown;
    return { data: data as never };
  },
};

/**
 * The recordings endpoints of 014-design §10, built in ONE place so a caller
 * never hand-concatenates a path (and never reaches a DELETE — none exists).
 */
export const recordingsUrl = {
  collection: (eventId: string) => `${ADMIN_BASE}/events/${eventId}/recordings`,
  row: (eventId: string, recordingId: string) =>
    `${ADMIN_BASE}/events/${eventId}/recordings/${recordingId}`,
  command: (eventId: string, recordingId: string, command: RecordingCommand) =>
    `${ADMIN_BASE}/events/${eventId}/recordings/${recordingId}/${command}`,
};

/**
 * The 012 EARS-7 event↔expert link endpoints (012-design §5.1, #1289), built in
 * ONE place like the recordings paths so no caller hand-concatenates a route —
 * and so no caller can reach a DELETE, because the join controller exposes none.
 *
 * The links are NOT a Refine CRUD resource: they are always read filtered to one
 * parent event and written with named retire/restore commands, so they ride the
 * `custom` path (which owns the Idempotency-Key + If-Match protocol headers)
 * rather than `getList`/`update`.
 */
export const eventExpertsUrl = {
  collection: (query?: {
    eventId?: string;
    expertId?: string;
    includeRetired?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (query?.eventId) params.set("eventId", query.eventId);
    if (query?.expertId) params.set("expertId", query.expertId);
    if (query?.includeRetired) params.set("includeRetired", "true");
    if (query?.page) params.set("page", String(query.page));
    if (query?.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return qs
      ? `${ADMIN_BASE}/event-experts?${qs}`
      : `${ADMIN_BASE}/event-experts`;
  },
  row: (linkId: string) => `${ADMIN_BASE}/event-experts/${linkId}`,
  command: (linkId: string, command: "retire" | "restore") =>
    `${ADMIN_BASE}/event-experts/${linkId}/${command}`,
};

/**
 * The `event_projects` relationship endpoints (012-design §5.1, EARS-6 / #1288).
 *
 * One flat collection filtered by EITHER endpoint — that is how the same route
 * serves «проекты этого эфира» on the event detail and «эфиры этого проекта» on
 * the project detail. There is no `PATCH` and no `DELETE` anywhere in the map: an
 * event↔project link is attribute-less, and its lifecycle is the two named
 * commands behind the §3.1 impact gate.
 */
export const eventProjectsUrl = {
  collection: () => `${ADMIN_BASE}/event-projects`,
  list: (query: {
    eventId?: string;
    projectId?: string;
    includeRetired?: boolean;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.eventId) params.set("eventId", query.eventId);
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.includeRetired) params.set("includeRetired", "true");
    params.set("pageSize", String(query.pageSize ?? ADMIN_LIST_PAGE_SIZE_MAX));
    return `${ADMIN_BASE}/event-projects?${params.toString()}`;
  },
  row: (id: string) => `${ADMIN_BASE}/event-projects/${id}`,
  /** The §3.1 preview. Transition-specific: a token binds exactly one of them. */
  impact: (id: string, transition: TaxonomyLifecycleTransition) =>
    `${ADMIN_BASE}/event-projects/${id}/lifecycle-impact?transition=${transition}`,
  transition: (id: string, transition: TaxonomyLifecycleTransition) =>
    `${ADMIN_BASE}/event-projects/${id}/${transition}`,
};

/**
 * The `event_directions` relationship endpoints (012-design §5.1, EARS-11 / #1293).
 *
 * Same flat-collection shape as `eventProjectsUrl`, filtered by EITHER endpoint,
 * so one route serves «направления этого эфира» on the event detail and «эфиры
 * этого направления» from the direction side. No `PATCH` and no `DELETE`: an
 * event↔direction link is
 * attribute-less, and its lifecycle is the two named commands behind the §3.1
 * impact gate.
 */
export const eventDirectionsUrl = {
  collection: () => `${ADMIN_BASE}/event-directions`,
  list: (query: {
    eventId?: string;
    directionId?: string;
    includeRetired?: boolean;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.eventId) params.set("eventId", query.eventId);
    if (query.directionId) params.set("directionId", query.directionId);
    if (query.includeRetired) params.set("includeRetired", "true");
    params.set("pageSize", String(query.pageSize ?? ADMIN_LIST_PAGE_SIZE_MAX));
    return `${ADMIN_BASE}/event-directions?${params.toString()}`;
  },
  row: (id: string) => `${ADMIN_BASE}/event-directions/${id}`,
  /** The §3.1 preview. Transition-specific: a token binds exactly one of them. */
  impact: (id: string, transition: TaxonomyLifecycleTransition) =>
    `${ADMIN_BASE}/event-directions/${id}/lifecycle-impact?transition=${transition}`,
  transition: (id: string, transition: TaxonomyLifecycleTransition) =>
    `${ADMIN_BASE}/event-directions/${id}/${transition}`,
};

/**
 * The `project_experts` relationship endpoints (012-design §5.1, EARS-9 / #1291).
 *
 * One flat collection filtered by EITHER endpoint, exactly like `event-projects`:
 * the same route serves «эксперты этого проекта» on the project detail and
 * «проекты этого эксперта» on the expert detail, so the panel is one component
 * with a `mode` rather than two lists that can drift apart.
 *
 * `replaceCurator` hangs off `/projects/:id`, not off a relation, because the
 * invariant it preserves («опубликованный проект имеет ровно одного куратора»)
 * belongs to the PROJECT — so its `If-Match` is the project's version, and the
 * caller must pass `meta.version` from the project it rendered, never from a row.
 */
export const projectExpertsUrl = {
  collection: () => `${ADMIN_BASE}/project-experts`,
  list: (query: {
    projectId?: string;
    expertId?: string;
    role?: "curator" | "member";
    status?: RelationshipStatus;
    includeRetired?: boolean;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.expertId) params.set("expertId", query.expertId);
    if (query.role) params.set("role", query.role);
    if (query.status) params.set("status", query.status);
    if (query.includeRetired) params.set("includeRetired", "true");
    params.set("pageSize", String(query.pageSize ?? ADMIN_LIST_PAGE_SIZE_MAX));
    return `${ADMIN_BASE}/project-experts?${params.toString()}`;
  },
  row: (id: string) => `${ADMIN_BASE}/project-experts/${id}`,
  command: (id: string, command: "retire" | "restore") =>
    `${ADMIN_BASE}/project-experts/${id}/${command}`,
  replaceCurator: (projectId: string) =>
    `${ADMIN_BASE}/projects/${projectId}/replace-curator`,
};

/**
 * The `project_partners` relationship endpoints (012-design §5.1, EARS-10 / #1292).
 *
 * Same bidirectional shape as `projectExpertsUrl`. There is no «сделать основным»
 * command URL: `isPrimary` is an ATTRIBUTE of the row and moves through the
 * ordinary `PATCH`, so the operator clears the incumbent and sets the successor
 * as two explicit edits rather than one control that silently rewrites another
 * row (that is what the partial unique refuses with 409 anyway).
 */
export const projectPartnersUrl = {
  collection: () => `${ADMIN_BASE}/project-partners`,
  list: (query: {
    projectId?: string;
    partnerId?: string;
    isPrimary?: boolean;
    status?: RelationshipStatus;
    includeRetired?: boolean;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (query.projectId) params.set("projectId", query.projectId);
    if (query.partnerId) params.set("partnerId", query.partnerId);
    if (query.isPrimary !== undefined) {
      params.set("isPrimary", String(query.isPrimary));
    }
    if (query.status) params.set("status", query.status);
    if (query.includeRetired) params.set("includeRetired", "true");
    params.set("pageSize", String(query.pageSize ?? ADMIN_LIST_PAGE_SIZE_MAX));
    return `${ADMIN_BASE}/project-partners?${params.toString()}`;
  },
  row: (id: string) => `${ADMIN_BASE}/project-partners/${id}`,
  command: (id: string, command: "retire" | "restore") =>
    `${ADMIN_BASE}/project-partners/${id}/${command}`,
};

/**
 * The direction ENTITY's lifecycle commands (012 EARS-13/14, §3.1; 017 EARS-18).
 *
 * The book itself stays a Refine CRUD resource — the list, the create and the
 * PATCH all go through `directions` — so this map holds ONLY what CRUD has no
 * verb for: `draft → published`, and the two impact-gated transitions. That is
 * the same split `eventProjectsUrl` makes, for the same reason: a command is not
 * an update of a field, and the `custom` path is what owns the
 * Idempotency-Key / If-Match / lifecycle-impact-token protocol headers.
 *
 * There is no `delete` here and there never will be (§3.1): a direction is
 * retired, keeping its id and its slug, so an audit trail and a doctor's
 * bookmark both keep resolving.
 */
export const directionsUrl = {
  row: (id: string) => `${ADMIN_BASE}/directions/${id}`,
  /** `draft → published`. Carries no impact envelope — a publish withdraws nothing. */
  publish: (id: string) => `${ADMIN_BASE}/directions/${id}/publish`,
  /** The §3.1 preview. Transition-specific: a token binds exactly one of them. */
  impact: (id: string, transition: TaxonomyLifecycleTransition) =>
    `${ADMIN_BASE}/directions/${id}/lifecycle-impact?transition=${transition}`,
  transition: (id: string, transition: TaxonomyLifecycleTransition) =>
    `${ADMIN_BASE}/directions/${id}/${transition}`,
};

/**
 * The #1483 direction↔specialty link endpoints (ADR-0016 §5; 017-design §5).
 *
 * Built the same way `eventProjectsUrl` is, and NOT registered as a Refine CRUD
 * resource, for the same three reasons: the collection is always read scoped to an
 * endpoint rather than as a flat book, the writes are the two named retire/restore
 * commands rather than a PATCH, and the list query is `.strict()` — it accepts no
 * `q`, so the generic taxonomy `getList` (which always sets `page`/`pageSize` and
 * may set `q`) would build a query the API refuses. The `custom` path is also what
 * owns the Idempotency-Key + If-Match protocol headers, which every write here owes.
 *
 * There is no `PATCH` and no `DELETE` in the map because the API exposes neither:
 * the link is attribute-less, so re-pointing it is retiring one row and authoring
 * another.
 */
export const directionSpecialtiesUrl = {
  collection: () => `${ADMIN_BASE}/direction-specialties`,
  list: (query: {
    directionId?: string;
    specialtyMinzdravId?: string;
    status?: RelationshipStatus;
    includeRetired?: boolean;
    page?: number;
    pageSize?: number;
  }) => `${ADMIN_BASE}/direction-specialties?${relationQuery(query)}`,
  row: (id: string) => `${ADMIN_BASE}/direction-specialties/${id}`,
  transition: (id: string, transition: RelationshipTransition) =>
    `${ADMIN_BASE}/direction-specialties/${id}/${transition}`,
};

/**
 * The #1483 direction adjacency endpoints (ADR-0016 §5; 017-design §5). Same
 * shape as the specialty links above, plus the one route they do not have: an
 * adjacency edge carries `kind` and `weight`, so `PATCH :id` re-labels or
 * re-weights the SAME edge. The endpoints are the edge's identity and are not
 * patchable — moving an edge is retiring one and authoring another — which is why
 * `row()` is the only path a write ever needs.
 */
export const directionAdjacencyUrl = {
  collection: () => `${ADMIN_BASE}/direction-adjacency`,
  list: (query: {
    directionId?: string;
    adjacentDirectionId?: string;
    kind?: string;
    status?: RelationshipStatus;
    includeRetired?: boolean;
    page?: number;
    pageSize?: number;
  }) => `${ADMIN_BASE}/direction-adjacency?${relationQuery(query)}`,
  row: (id: string) => `${ADMIN_BASE}/direction-adjacency/${id}`,
  transition: (id: string, transition: RelationshipTransition) =>
    `${ADMIN_BASE}/direction-adjacency/${id}/${transition}`,
};

/**
 * The publish command of the three remaining taxonomy entities (012 EARS-5,
 * #1287). Built the same way `directionsUrl.publish` is, for the same reason:
 * each stays a Refine CRUD resource for its list / create / PATCH, and this map
 * holds ONLY what CRUD has no verb for — `draft → published`. The `custom` path
 * is what owns the Idempotency-Key / If-Match protocol headers a command owes.
 *
 * There is no `retire` and no `restore` here YET (#1295/#1296): the API exposes
 * neither for these kinds, and a builder for a route that 404s is a button that
 * lies. There will never be a `delete` (§3.1).
 */
export const projectsUrl = {
  publish: (id: string) => `${ADMIN_BASE}/projects/${id}/publish`,
};

export const expertsUrl = {
  publish: (id: string) => `${ADMIN_BASE}/experts/${id}/publish`,
};

export const partnersUrl = {
  publish: (id: string) => `${ADMIN_BASE}/partners/${id}/publish`,
};

/** The two named lifecycle commands a relationship row answers to. */
export type RelationshipTransition = "retire" | "restore";

/**
 * The query string of a direction-relation list. Both list schemas are
 * `.strict()`, so an empty-string or `undefined` value is OMITTED rather than
 * serialized: `?directionId=` is a validation failure, not "no filter".
 */
function relationQuery(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "" || value === false) continue;
    params.set(key, String(value));
  }
  return params.toString();
}

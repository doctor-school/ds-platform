"use client";

import type { DataProvider, HttpError } from "@refinedev/core";
import { adminCsrfHeaders } from "@/lib/admin-auth";
import type {
  ConfigureStreamRequest,
  CreateEventRequest,
  CreateExpertRequest,
  CreateProjectRequest,
  EventAdminDetail,
  EventAdminListItem,
  ExpertAdminDetail,
  ExpertAdminListItem,
  ProjectAdminDetail,
  ProjectAdminListItem,
  CreateTopicRequest,
  TaxonomyStatus,
  TopicAdminDetail,
  TopicAdminListItem,
  UpdateEventRequest,
  UpdateExpertRequest,
  UpdateProjectRequest,
  UpdateTopicRequest,
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
 * Two resources today:
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
 *   topics   (012)  the same four calls against /v1/admin/topics, with NO file
 *                   part at all — a topic is a title plus its address, so every
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
  // A topic carries no image anywhere in the entity (012-design §2.2 / §5.1): it
  // is a title plus its permanent address. `null` registers the resource on this
  // map — so list/detail/create/update all dispatch for it — WITHOUT inventing a
  // file part the API has no route for; its writes are always JSON (#1285).
  topics: null,
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

/** Topic create variables: the authored fields, and nothing else — no media part (#1285). */
export type CreateTopicVars = CreateTopicRequest;
/** Topic edit variables. `version` becomes the `If-Match` precondition. */
export type UpdateTopicVars = UpdateTopicRequest & { version: number };

/** The taxonomy detail projections this provider can return. */
type TaxonomyDetail = ProjectAdminDetail | ExpertAdminDetail | TopicAdminDetail;
/** The taxonomy list rows this provider can return. */
type TaxonomyListItem =
  | ProjectAdminListItem
  | ExpertAdminListItem
  | TopicAdminListItem;

/**
 * The file part of a taxonomy write, resolved off the resource map. A resource
 * registered with `null` (topics) has no file part at all, so no variable of the
 * write can ever be read as one.
 */
function taxonomyFile(
  resource: TaxonomyResource,
  files: { cover?: File | null; photo?: File | null },
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
    const res = await fetch(`${ADMIN_BASE}/events`, {
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
      const { cover, photo, ...payload } = variables as CreateProjectVars &
        CreateExpertVars &
        CreateTopicVars;
      const { body, headers } = taxonomyBody(
        resource,
        payload as Record<string, unknown>,
        taxonomyFile(resource, { cover, photo }),
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
      const {
        cover,
        photo,
        version,
        ...payload
      } = variables as UpdateProjectVars & UpdateExpertVars & UpdateTopicVars;
      const { body, headers } = taxonomyBody(
        resource,
        payload as Record<string, unknown>,
        taxonomyFile(resource, { cover, photo }),
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
   * The stream-config write (007 EARS-3) and the named lifecycle transitions
   * (EARS-4/5/6) — the non-CRUD commands. `payload` carries either the
   * `ConfigureStreamRequest` body (for `PUT :id/stream`) or is empty (for the
   * `POST :id/{publish|open|close|archive}` transitions). `method` + `url` are
   * supplied by the caller (`useCustomMutation`).
   */
  custom: async ({ url, method, payload }) => {
    const hasBody = payload !== undefined && method !== "get";
    const res = await fetch(url, {
      method: (method ?? "post").toUpperCase(),
      credentials: "include",
      // A `get` through `custom` is a read and owes no CSRF proof; everything
      // else on this path is a state-changing admin command (EARS-10).
      headers: {
        ...(hasBody
          ? { "content-type": "application/json", accept: "application/json" }
          : { accept: "application/json" }),
        ...(method === "get" ? {} : adminCsrfHeaders()),
      },
      body: hasBody
        ? JSON.stringify(payload as ConfigureStreamRequest | undefined)
        : undefined,
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },
};

"use client";

import type { DataProvider, HttpError } from "@refinedev/core";
import type {
  ConfigureStreamRequest,
  CreateEventRequest,
  EventAdminDetail,
  EventAdminListItem,
  UpdateEventRequest,
} from "@ds/schemas";

/**
 * Custom Refine REST data provider over the NestJS 007 admin surface (ADR-0004 §5
 * — Refine + custom REST data provider). Every call hits the RELATIVE `/v1/admin/*`
 * path with `credentials: "include"`, so it rides the admin's own origin and the
 * `__Host-ds_session` `platform_admin` cookie the shipped 003 BFF set (proxied to
 * the api by `next.config.ts` `rewrites()`). No absolute api URL, no token in JS.
 *
 * The `events` resource maps to the design §7 endpoints:
 *   getList  → GET   /v1/admin/events            (EventAdminList)
 *   getOne   → GET   /v1/admin/events/:id        (EventAdminDetail)
 *   create   → POST  /v1/admin/events            (multipart: payload + programPdf)
 *   update   → PATCH /v1/admin/events/:id        (multipart: payload + programPdf)
 *   custom   → PUT   /v1/admin/events/:id/stream (ConfigureStream) and
 *              POST  /v1/admin/events/:id/{publish|open|close|archive} (transitions)
 *
 * Create/update ride `multipart/form-data` because the program PDF (EARS-1/2) is a
 * file part alongside the JSON `payload`; the authoring writes therefore build a
 * `FormData`, not a JSON body.
 */
const ADMIN_BASE = "/v1/admin";

/** Variables the create form hands the provider — the authored aggregate + an optional PDF. */
export type CreateEventVars = CreateEventRequest & { programPdf?: File | null };
/** Variables the edit form hands the provider — a partial aggregate + an optional replacement PDF. */
export type UpdateEventVars = UpdateEventRequest & { programPdf?: File | null };

async function toHttpError(res: Response): Promise<HttpError> {
  let message = `Запрос завершился ошибкой (${res.status})`;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string") message = body.message;
  } catch {
    // Non-JSON / empty body — keep the generic message.
  }
  return { message, statusCode: res.status };
}

/** Split the authoring variables into the JSON payload and the file part. */
function toAuthoringForm(
  vars: CreateEventVars | UpdateEventVars,
): FormData {
  const { programPdf, ...payload } = vars;
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  if (programPdf) form.append("programPdf", programPdf);
  return form;
}

export const dataProvider: DataProvider = {
  getApiUrl: () => ADMIN_BASE,

  getList: async ({ resource }) => {
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
    if (resource !== "events") throw new Error(`unknown resource: ${resource}`);
    const res = await fetch(`${ADMIN_BASE}/events`, {
      method: "POST",
      credentials: "include",
      body: toAuthoringForm(variables as CreateEventVars),
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },

  update: async ({ resource, id, variables }) => {
    if (resource !== "events") throw new Error(`unknown resource: ${resource}`);
    const res = await fetch(`${ADMIN_BASE}/events/${id}`, {
      method: "PATCH",
      credentials: "include",
      body: toAuthoringForm(variables as UpdateEventVars),
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },

  deleteOne: async () => {
    // 007 has no delete affordance (the lifecycle is archive, never destroy).
    throw new Error("delete is not supported for events");
  },

  /**
   * The stream-config write (EARS-3) and the named lifecycle transitions
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
      headers: hasBody
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
      body: hasBody
        ? JSON.stringify(payload as ConfigureStreamRequest | undefined)
        : undefined,
    });
    if (!res.ok) throw await toHttpError(res);
    const data = (await res.json()) as EventAdminDetail;
    return { data: data as unknown as never };
  },
};

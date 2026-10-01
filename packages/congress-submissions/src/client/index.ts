import {
  type CongressSubmission,
  type CongressSubmissionDraftContent,
  type CongressSubmissionKind,
  type CongressSubmissionProblem,
  type CongressSubmissionSection,
  type CongressSubmissionStatus,
  CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE,
  CongressSubmissionRefusalSchema,
} from "@ds/schemas";

/**
 * Same-origin client of `/v1/me/congress-submissions*` (046-design «Send
 * cascade»). Relative paths with `credentials: "include"`: each storefront
 * rewrites `/v1/*` to the api and holds its own session cookie, so one client
 * serves whichever host mounts the section.
 */

const BASE = "/v1/me/congress-submissions";

/** A non-2xx answer; `problems` when the api named them (422 / 409). */
export class CongressSubmissionsError extends Error {
  constructor(
    readonly status: number,
    readonly problems: CongressSubmissionProblem[] = [],
  ) {
    super(`congress submissions request failed (${status})`);
    this.name = "CongressSubmissionsError";
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  });
  if (!res.ok) {
    let problems: CongressSubmissionProblem[] = [];
    try {
      const parsed = CongressSubmissionRefusalSchema.safeParse(await res.json());
      if (parsed.success) problems = parsed.data.problems;
    } catch {
      // A body that is not a refusal carries no problems to name.
    }
    throw new CongressSubmissionsError(res.status, problems);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** The section of the congress event (046 EARS-4). */
export function fetchSection(): Promise<CongressSubmissionSection> {
  return call<CongressSubmissionSection>("");
}

export function createDraft(
  eventId: string,
  kind: CongressSubmissionKind,
): Promise<CongressSubmission> {
  return call("", { method: "POST", json: { eventId, kind } });
}

/**
 * Autosave the whole draft (046 EARS-7). `keepalive` lets the flush on page
 * hide finish after the document is gone.
 */
export function saveDraft(
  id: string,
  content: CongressSubmissionDraftContent,
  opts: { keepalive?: boolean } = {},
): Promise<CongressSubmission> {
  return call(`/${id}`, {
    method: "PATCH",
    json: content,
    keepalive: opts.keepalive ?? false,
  });
}

export function sendSubmission(
  id: string,
  acceptConsent: boolean,
): Promise<CongressSubmission> {
  return call(`/${id}/send`, {
    method: "POST",
    json: {
      acceptedConsents: acceptConsent
        ? [CONGRESS_SUBMISSION_PERSONAL_DATA_PURPOSE]
        : [],
    },
  });
}

export function withdrawSubmission(
  id: string,
  expectedStatus: CongressSubmissionStatus,
): Promise<CongressSubmission> {
  return call(`/${id}/withdraw`, { method: "POST", json: { expectedStatus } });
}

export function deleteDraft(id: string): Promise<void> {
  return call(`/${id}`, { method: "DELETE" });
}

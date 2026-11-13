import type {
  LearningAttempt,
  LearningAttemptResult,
  LearningCoursePath,
  LearningLessonRead,
  LearningStepRead,
  RecordLearningFactRequest,
  RecordLearningFactResponse,
  SubmitLearningAttemptRequest,
} from "@ds/schemas";

// 024 design §1 `./client` — the browser / app transport for `/v1/learning/*`
// and `/v1/me/learning/*` (EARS-10, 13, 15, 18, 25). In a browser the base is
// the page's own origin: the storefront's `/v1/*` rewrite carries the session
// cookie to the api. A server caller passes the api origin and the forwarded
// session headers.

/** A refused or failed learning call: the HTTP status and the problem `code`. */
export class LearningClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly body: unknown,
  ) {
    super(`learning request failed: ${status}${code ? ` ${code}` : ""}`);
    this.name = "LearningClientError";
  }
}

export interface LearningClientOptions {
  /** The api origin; empty = the calling page's origin (browser). */
  baseUrl?: string;
  /** Extra request headers (the forwarded session on a server caller). */
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export interface LearningClient {
  coursePath(courseSlug: string): Promise<LearningCoursePath>;
  lesson(lessonId: string): Promise<LearningLessonRead>;
  step(stepId: string): Promise<LearningStepRead>;
  recordFact(fact: RecordLearningFactRequest): Promise<RecordLearningFactResponse>;
  startAttempt(testId: string): Promise<LearningAttempt>;
  submitAttempt(
    attemptId: string,
    body: SubmitLearningAttemptRequest,
  ): Promise<LearningAttemptResult>;
}

export function createLearningClient(
  options: LearningClientOptions = {},
): LearningClient {
  const base = (options.baseUrl ?? "").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "include",
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const code =
        parsed && typeof parsed === "object" && "code" in parsed
          ? String((parsed as { code: unknown }).code)
          : null;
      throw new LearningClientError(res.status, code, parsed);
    }
    return parsed as T;
  }

  const seg = encodeURIComponent;
  return {
    coursePath: (slug) => call("GET", `/v1/learning/courses/${seg(slug)}/path`),
    lesson: (id) => call("GET", `/v1/learning/lessons/${seg(id)}`),
    step: (id) => call("GET", `/v1/me/learning/steps/${seg(id)}`),
    recordFact: (fact) => call("POST", "/v1/me/learning/facts", fact),
    startAttempt: (testId) =>
      call("POST", `/v1/me/learning/tests/${seg(testId)}/attempts`, {}),
    submitAttempt: (attemptId, body) =>
      call("POST", `/v1/me/learning/attempts/${seg(attemptId)}/submit`, body),
  };
}

/** A fresh client event id for a progress fact (EARS-10: never the `learning:` prefix). */
export function newLearningEventId(stepId: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web:${stepId}:${rnd}`;
}

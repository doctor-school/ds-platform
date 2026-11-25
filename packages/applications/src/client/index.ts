import {
  type ApplicantApplicationList,
  ApplicantApplicationListSchema,
  type ApplicationRefusal,
  ApplicationRefusalSchema,
  type AuthorApplicationIntake,
  type AuthorApplicationIntakeResult,
} from "@ds/schemas";

import type { OwnApplicationsRead } from "../model/submission";

/**
 * Same-origin client of `/v1/me/applications*` (033-design «Endpoints").
 * Relative paths with `credentials: "include"`: the Academy storefront
 * rewrites `/v1/*` to the api and holds the session cookie.
 */

const BASE = "/v1/me/applications";
/** The 003 bot-protection proof header (`@BotProtected("application")`). */
export const BOT_PROTECTION_TOKEN_HEADER = "x-smartcaptcha-token";

/**
 * A failed request. `status` 0 = the network failed before an answer;
 * `problems` when the api named them (`400` / `422`); `code` the api's own
 * machine-readable code otherwise (the bot-protection refusal).
 */
export class ApplicationsError extends Error {
  constructor(
    readonly status: number,
    readonly problems: ApplicationRefusal["problems"] = [],
    readonly code?: string,
  ) {
    super(`applications request failed (${status})`);
    this.name = "ApplicationsError";
  }
}

async function request(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: "include" });
  } catch {
    throw new ApplicationsError(0);
  }
  if (!res.ok) {
    let problems: ApplicationRefusal["problems"] = [];
    let code: string | undefined;
    try {
      const body: unknown = await res.json();
      const parsed = ApplicationRefusalSchema.safeParse(body);
      if (parsed.success) problems = parsed.data.problems;
      const raw = (body as { code?: unknown } | null)?.code;
      if (typeof raw === "string") code = raw;
    } catch {
      // A body that is not JSON names nothing.
    }
    throw new ApplicationsError(res.status, problems, code);
  }
  return res.json();
}

/**
 * EARS-7, EARS-8 — `POST /v1/me/applications/author`. The caller passes the
 * form instance's idempotency key (kept across retries) and the
 * bot-protection proof when the widget produced one.
 */
export async function submitAuthorApplication(
  body: AuthorApplicationIntake,
  opts: { idempotencyKey: string; captchaToken?: string },
): Promise<AuthorApplicationIntakeResult> {
  return (await request(`${BASE}/author`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "idempotency-key": opts.idempotencyKey,
      ...(opts.captchaToken
        ? { [BOT_PROTECTION_TOKEN_HEADER]: opts.captchaToken }
        : {}),
    },
    body: JSON.stringify(body),
  })) as AuthorApplicationIntakeResult;
}

/** EARS-10 — `GET /v1/me/applications?kind=author`, parsed. */
export async function fetchOwnAuthorApplications(): Promise<ApplicantApplicationList> {
  const body = await request(`${BASE}?kind=author`, {
    headers: { accept: "application/json" },
  });
  const parsed = ApplicantApplicationListSchema.safeParse(body);
  if (!parsed.success) throw new ApplicationsError(200);
  return parsed.data;
}

/**
 * EARS-10 — the read as the page consumes it: any failure (network, status,
 * an answer off the contract) is `{ ok: false }`, which hides the banner and
 * keeps the form; it never throws.
 */
export async function readOwnAuthorApplications(): Promise<OwnApplicationsRead> {
  try {
    return { ok: true, list: await fetchOwnAuthorApplications() };
  } catch {
    return { ok: false };
  }
}

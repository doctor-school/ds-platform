import { BotProtectionErrorCodes } from "@ds/schemas";

import {
  ACADEMY_CONSENT_VERSION_TAG,
  ACADEMY_PARTNERSHIP_WRITE_ERROR,
  type AcademyPartnershipActionResult,
  type AcademyPartnershipSubmission,
} from "./academy-partnership-schema";

/**
 * 033 EARS-18 — the Academy home's interim partnership form posts into the
 * application queue (`POST /v1/public/applications/partnership`, guest,
 * `@BotProtected("partnership")`). The browser calls it same-origin through the
 * portal's `/v1/*` BFF rewrite, so the api's bot guard sees the visitor's own
 * request; nothing is written by the portal.
 */
export const ACADEMY_PARTNERSHIP_INTAKE_PATH =
  "/v1/public/applications/partnership";

/** The header the api's bot guard reads the SmartCaptcha token from. */
const BOT_PROTECTION_TOKEN_HEADER = "x-smartcaptcha-token";

const BOT_PROTECTION_CODES: ReadonlySet<string> = new Set([
  BotProtectionErrorCodes.required,
  BotProtectionErrorCodes.rejected,
]);

/**
 * A 003 challenge refusal. It is thrown (not returned) so the shared
 * `useBotProtectedAction` routes it to the challenge copy through the
 * code-reading predicates of `@ds/design-system/blocks`.
 */
export class AcademyPartnershipChallengeError extends Error {
  constructor(readonly code: string) {
    super(`partnership intake refused the bot-protection proof: ${code}`);
    this.name = "AcademyPartnershipChallengeError";
  }
}

async function responseCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

const FAILED: AcademyPartnershipActionResult = {
  status: "error",
  message: ACADEMY_PARTNERSHIP_WRITE_ERROR,
};

/**
 * One submission attempt. The caller owns the idempotency key: a retry of the
 * same values sends the same key, so the api answers with the first row.
 */
export async function postAcademyPartnership(
  submission: AcademyPartnershipSubmission,
  captchaToken?: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<AcademyPartnershipActionResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": submission.idempotencyKey,
  };
  if (captchaToken) headers[BOT_PROTECTION_TOKEN_HEADER] = captchaToken;

  let response: Response;
  try {
    response = await fetchImpl(ACADEMY_PARTNERSHIP_INTAKE_PATH, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: submission.name,
        ...(submission.companyOrClinic
          ? { companyOrClinic: submission.companyOrClinic }
          : {}),
        contact: submission.contact,
        role: submission.role,
        consentVersion: ACADEMY_CONSENT_VERSION_TAG,
      }),
    });
  } catch {
    return FAILED;
  }

  if (response.ok) return { status: "success" };
  if (response.status === 403) {
    const code = await responseCode(response);
    if (code && BOT_PROTECTION_CODES.has(code)) {
      throw new AcademyPartnershipChallengeError(code);
    }
  }
  return FAILED;
}

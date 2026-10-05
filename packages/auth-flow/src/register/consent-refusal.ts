import {
  MEDICAL_WORKER_DECLARATION_REQUIRED_CODE,
  PARTNER_DATA_SHARING_REQUIRED_CODE,
} from "@ds/schemas";

import { AuthError } from "../client/auth-client";
import type { AuthFlowConsentsCopy } from "../host-config";

/**
 * The ONE reading of a 021 access-condition refusal (021 EARS-12): each refusal
 * code names one condition, and that condition is said in the sentence its own
 * consent row reports when left ungranted. The registration door states its
 * unrenderable precondition through this table, and the code step reads a 422
 * from the doctor verify command (the held consent travels there with the code)
 * through it too, so one refusal never reads two ways.
 */
const UNMET_BY_REFUSAL_CODE: Readonly<
  Record<string, (copy: AuthFlowConsentsCopy) => string | undefined>
> = {
  [MEDICAL_WORKER_DECLARATION_REQUIRED_CODE]: (copy) =>
    copy.medicalWorkerDeclaration.unmet,
  [PARTNER_DATA_SHARING_REQUIRED_CODE]: (copy) => copy.partnerDataItem.unmet,
};

/** The unmet sentence for a 021 refusal code; `null` for any other code. */
export function consentUnmetMessage(
  copy: AuthFlowConsentsCopy,
  refusalCode: string | undefined,
): string | null {
  if (!refusalCode) return null;
  return UNMET_BY_REFUSAL_CODE[refusalCode]?.(copy) ?? null;
}

/** The unmet sentence when `error` is a 021 access-condition refusal; else `null`. */
export function consentRefusalMessage(
  error: unknown,
  copy: AuthFlowConsentsCopy,
): string | null {
  if (!(error instanceof AuthError) || error.status !== 422) return null;
  return consentUnmetMessage(copy, error.code);
}

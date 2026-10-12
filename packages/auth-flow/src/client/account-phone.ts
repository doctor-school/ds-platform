import type { AccountPhoneActions } from "@ds/design-system/account-profile-card";

import { AuthError, type AuthClient } from "./auth-client";

/**
 * 003 EARS-47/48/59 (#2449) — the phone-row transport of the shared account
 * profile, built from a host's bound auth client. Both storefronts mount the
 * same adapter, so the doors, the statuses and the failure classification are
 * one behaviour; a host only supplies its client.
 *
 * Classification follows the BFF's generic outcomes: a 400 is the one generic
 * code failure (a wrong, expired or reused code, or a number confirmed on
 * another account — EARS-48/51); a 429 is the generic throttle (EARS-13/14);
 * every other failure, network included, is «unavailable».
 */
export function accountPhoneActions(client: AuthClient): AccountPhoneActions {
  return {
    async requestCode(phone) {
      const res = await client.requestPhoneCode({ phone });
      return res.status;
    },
    async confirm(code) {
      const res = await client.confirmPhone({ code });
      return res.phone;
    },
    classifyError(error) {
      if (error instanceof AuthError) {
        if (error.status === 400) return "invalid";
        if (error.status === 429) return "throttled";
      }
      return "unavailable";
    },
  };
}

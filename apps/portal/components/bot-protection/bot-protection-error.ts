import { BotProtectionErrorCodes } from "@ds/schemas";
import { AuthError } from "@/lib/auth-client";
import type { BotProtectionFailure } from "./smart-captcha";

export function isBotProtectionRequired(error: unknown): boolean {
  return (
    error instanceof AuthError &&
    error.code === BotProtectionErrorCodes.required
  );
}

export function isBotProtectionRejected(error: unknown): boolean {
  return (
    error instanceof AuthError &&
    error.code === BotProtectionErrorCodes.rejected
  );
}

export function botProtectionFailureMessage(
  failure: BotProtectionFailure,
  t: (key: string) => string,
): string {
  if (failure === "unavailable") return t("captchaUnavailable");
  if (failure === "expired") return t("captchaRejected");
  return t("captchaRequired");
}
